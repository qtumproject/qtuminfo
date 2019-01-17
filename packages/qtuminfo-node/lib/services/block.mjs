import assert from 'assert'
import LRU from 'lru-cache'
import Sequelize from 'sequelize'
import {Block} from 'qtuminfo-lib'
import Service from './base'
import {AsyncQueue} from '../utils'

const {gt: $gt, between: $between} = Sequelize.Op

export default class BlockService extends Service {
  constructor(options) {
    super(options)
    this.subscriptions = {block: [], transaction: [], address: []}
    this._tip = null
    this._header = this.node.services.get('header')
    this._initialSync = false
    this._processingBlock = false
    this._blocksInQueue = 0
    this._lastBlockSaved = Buffer.alloc(0)
    this._recentBlockHashesCount = options.recentBlockHashesCount || 144
    this._recentBlockHashes = new LRU(this._recentBlockHashesCount)
    this._readAheadBlockCount = options.readAheadBlockCount || 2
    this._pauseSync = options.pause
    this._reorgToBlock = options.reorgToBlock
  }

  static get dependencies() {
    return ['db', 'header', 'p2p']
  }

  get APIMethods() {
    return {
      getBlockTip: this.getTip.bind(this),
      isSynced: this.isSynced.bind(this)
    }
  }

  isSynced() {
    return !this._initialSync
  }

  getTip() {
    return this._tip
  }

  async _checkTip() {
    this.logger.info('Block Service: checking the saved tip...')
    let header = await this.Header.findByHeight(this._tip.height) || this._header.getLastHeader()
    if (Buffer.compare(header.hash, this._tip.hash) === 0 && !this._reorgToBlock) {
      this.logger.info('Block Service: saved tip is good to go')
    }
    await this._handleReorg()
  }

  async _resetTip() {
    if (!this._tipResetNeeded) {
      return
    }
    this._tipResetNeeded = false
    this.logger.warn('Block Service: resetting tip due to a non-exist tip block...')
    let {hash, height} = this._header.getLastHeader()
    this.logger.info('Block Service: retrieved all the headers of lookups')
    let block
    do {
      block = await this.Block.findOne({where: {hash}, attributes: ['hash']})
      if (!block) {
        this.logger.debug('Block Service: block:', hash.toString('hex'), 'was not found, proceeding to older blocks')
      }
      let header = await this.Block.findOne({where: {height: --height}, attributes: ['hash']})
      assert(header, 'Header not found for reset')
      if (!block) {
        this.logger.debug('Block Service: trying block:', header.hash.toString('hex'))
      }
    } while (!block)
    await this._setTip({height: height + 1, hash})
  }

  async start() {
    this.db = this.node.getDatabase()
    this.Header = this.node.getModel('header')
    this.Block = this.node.getModel('block')
    this.Transaction = this.node.getModel('transaction')
    this.TransactionOutput = this.node.getModel('transaction_output')
    this.Receipt = this.node.getModel('receipt')
    this.ContractSpend = this.node.getModel('contract_spend')
    let tip = await this.node.getServiceTip('block')
    if (tip.height > 0 && !await this.Block.findOne({where: {height: tip.height}, attributes: ['height']})) {
      tip = null
    }
    this._blockProcessor = new AsyncQueue(this._onBlock.bind(this))
    this._bus = this.node.openBus({remoteAddress: 'localhost-block'})
    if (!tip) {
      this._tipResetNeeded = true
      return
    }
    await this.Block.destroy({where: {height: {[$gt]: tip.height}}})
    this._header.on('reorg', () => {this._reorging = true})
    this._header.on('reorg complete', () => {this._reorging = false})
    await this._setTip(tip)
    await this._loadRecentBlockHashes()
  }

  async _loadRecentBlockHashes() {
    let hashes = (await this.Block.findAll({
      where: {
        height: {
          [$between]: [
            this._tip.height - this._recentBlockHashesCount,
            this._tip.height
          ]
        }
      },
      attributes: ['hash'],
      order: [['height', 'ASC']]
    })).map(block => block.hash)
    for (let i = 0; i < hashes.length - 1; ++i) {
      this._recentBlockHashes.set(hashes[i + 1].toString('hex'), hashes[i])
    }
    this.logger.info('Block Service: loaded:', this._recentBlockHashes.length, 'hashes from the index')
  }

  async _getTimeSinceLastBlock() {
    let header = await this.Header.findOne({
      where: {height: Math.max(this._tip.height - 1, 0)},
      attributes: ['timestamp']
    })
    let tip = await this.Header.findOne({
      where: {height: this._tip.height},
      attributes: ['timestamp']
    })
    return convertSecondsToHumanReadable(tip.timestamp - header.timestamp)
  }

  _queueBlock(block) {
    ++this._blocksInQueue
    this._blockProcessor.push(block, err => {
      if (err) {
        this._handleError(err)
      } else {
        this._logSynced(block.hash)
        --this._blocksInQueue
      }
    })
  }

  async onReorg(height) {
    await this.Block.destroy({where: {height: {[$gt]: height}}})
  }

  async _onReorg(blocks) {
    let targetHeight = blocks[blocks.length - 1].height - 1
    let {hash: targetHash} = await this.Header.findByHeight(targetHeight, {attributes: ['hash']})
    try {
      for (let service of this.node.getServicesByOrder().reverse()) {
        this.logger.info('Block Service: reorging', service.name, 'service')
        await service.onReorg(targetHeight, targetHash)
      }
    } catch (err) {
      this._handleError(err)
    }
  }

  _removeAllSubscriptions() {
    this._bus.unsubscribe('p2p/block')
    this._bus.removeAllListeners()
    this.removeAllListeners()
    this._subscribedBlock = false
    if (this._reportInterval) {
      clearInterval(this._reportInterval)
    }
    if (this._getBlocksTimer) {
      clearTimeout(this._getBlocksTimer)
    }
  }

  onHeaders() {
    if (this._pauseSync) {
      this.logger.warn('Block Service: pausing sync due to config option')
    } else {
      this._initialSync = true
      return new Promise(resolve => {
        let interval = setInterval(() => {
          if (!this._processingBlock) {
            clearInterval(interval)
            resolve(this._onHeaders())
          }
        }, 1000)
      })
    }
  }

  async _onHeaders() {
    await this._resetTip()
    return new Promise((resolve, reject) => {
      let interval = setInterval(async () => {
        if (this._blocksInQueue === 0) {
          clearInterval(interval)
          this._removeAllSubscriptions()
          try {
            await this._checkTip()
            this._reorging = false
            await this._startSync()
            resolve()
          } catch (err) {
            reject(err)
          }
        }
      }, 1000)
    })
  }

  _startBlockSubscription() {
    if (!this._subscribedBlock) {
      this._subscribedBlock = true
      this.logger.info('Block Service: starting p2p block subscription')
      this._bus.on('p2p/block', this._queueBlock.bind(this))
      this._bus.subscribe('p2p/block')
    }
  }

  async _findLatestValidBlockHeader() {
    if (this._reorgToBlock) {
      let header = await this.Header.findByHeight(this._reorgToBlock, {attributes: ['hash', 'height']})
      assert(header, 'Block Service: header not found to reorg to')
      return header
    }
    let blockServiceHash = this._tip.hash
    let blockServiceHeight = this._tip.height
    let header
    for (let i = 0; i <= this._recentBlockHashes.length; ++i) {
      let currentHeader = await this.Header.findByHash(blockServiceHash, {attributes: ['hash', 'height']})
      let hash = blockServiceHash
      let height = blockServiceHeight--
      blockServiceHash = this._recentBlockHashes.get(hash.toString('hex'))
      if (currentHeader && Buffer.compare(currentHeader.hash, hash) === 0 && currentHeader.height === height) {
        header = currentHeader
        break
      }
    }
    assert(
      header,
      [
        'Block Service: we could not locate any of our recent block hashes in the header service index.',
        'Perhaps our header service synced to the wrong chain?'
      ].join(' ')
    )
    assert(
      header.height <= this._tip.height,
      [
        'Block Service: we found a common ancestor header whose height was greater than our current tip.',
        'This should be impossible'
      ].join(' ')
    )
    return header
  }

  async _findBlocksToRemove(commonHeader) {
    let hash = this._tip.hash
    let blocks = []
    let {height} = await this.Block.findOne({where: {hash}, attributes: ['height']})
    for (let i = 0; i < this._recentBlockHashes.length && Buffer.compare(hash, commonHeader.hash) !== 0; ++i) {
      blocks.push({height, hash})
      let prevBlock = await this.Block.findOne({
        where: {height: --height},
        attributes: ['hash']
      })
      hash = prevBlock.hash
    }
    return blocks
  }

  async _handleReorg() {
    this.node.clearInventoryCache()
    let commonAncestorHeader = await this._findLatestValidBlockHeader()
    if (Buffer.compare(commonAncestorHeader.hash, this._tip.hash) === 0) {
      return
    }
    let blocksToRemove = await this._findBlocksToRemove(commonAncestorHeader)
    assert(
      blocksToRemove.length > 0 && blocksToRemove.length <= this._recentBlockHashes.length,
      'Block Service: the number of blocks to remove looks incorrect'
    )
    this.logger.warn(
      'Block Service: chain reorganization detected, current height/hash:',
      `${this._tip.height}/${this._tip.hash.toString('hex')}`,
      'common ancestor hash:', commonAncestorHeader.hash.toString('hex'),
      `at height: ${commonAncestorHeader.height}.`,
      'There are:', blocksToRemove.length, 'block(s) to remove'
    )
    await this._setTip({hash: commonAncestorHeader.hash, height: commonAncestorHeader.height})
    await this._processReorg(blocksToRemove)
  }

  async _processReorg(blocksToRemove) {
    for (let block of blocksToRemove) {
      this._recentBlockHashes.del(block.hash.toString('hex'))
    }
    await this._onReorg(blocksToRemove)
    this.logger.info('Block Service: removed', blocksToRemove.length, 'blocks(s) during the reorganization event')
  }

  async _onBlock(rawBlock) {
    if (this._reorging) {
      this._processingBlock = false
      return
    }
    this._processingBlock = true
    try {
      if (await this.Block.findOne({where: {hash: rawBlock.hash}, attributes: ['height']})) {
        this._processingBlock = false
        this.logger.debug('Block Service: not syncing, block already in database')
      } else {
        await this._processBlock(rawBlock)
      }
    } catch (err) {
      this._processingBlock = false
      this._handleError(err)
    }
  }

  async _processBlock(block) {
    if (this.node.stopping) {
      this._processingBlock = false
      return
    }
    this.logger.debug('Block Service: new block:', block.hash.toString('hex'))
    if (Buffer.compare(block.header.prevHash, this._tip.hash) === 0) {
      await this._saveBlock(block)
    } else {
      this._processingBlock = false
    }
  }

  async _saveBlock(rawBlock) {
    if (!('height' in rawBlock)) {
      rawBlock.height = this._tip.height + 1
    }
    try {
      for (let service of this.node.getServicesByOrder()) {
        await service.onBlock(rawBlock)
      }
      await this.__onBlock(rawBlock)
      this._recentBlockHashes.set(rawBlock.hash.toString('hex'), rawBlock.header.prevHash)
      await this._setTip({hash: rawBlock.hash, height: rawBlock.height})
      this._processingBlock = false
      for (let subscription of this.subscriptions.block) {
        subscription.emit('block/block', rawBlock)
      }
    } catch (err) {
      this._processingBlock = false
      throw err
    }
  }

  _handleError(err) {
    if (!this.node.stopping) {
      this.logger.error('Block Service: handle error', err)
      this.node.stop()
    }
  }

  async _syncBlock(block) {
    clearTimeout(this._getBlocksTimer)
    if (Buffer.compare(this._lastBlockSaved, block.hash) === 0) {
      this._processingBlock = false
      return
    }
    try {
      await this._saveBlock(block)
      this._lastBlockSaved = block.hash
      if (this._tip.height < this._header.getLastHeader().height) {
        this.emit('next block')
      } else {
        this.emit('synced')
      }
    } catch (err) {
      this._handleError(err)
    }
  }

  async __onBlock(rawBlock) {
    let header
    do {
      header = await this.Header.findByHash(rawBlock.hash, {attributes: ['height']})
    } while (!header)
    let minerId
    if (header.height > 5000) {
      minerId = (await this.TransactionOutput.findOne({
        where: {inputIndex: 0},
        attributes: ['addressId'],
        include: [{
          model: this.Transaction,
          as: 'inputTransaction',
          required: true,
          where: {blockHeight: header.height, indexInBlock: 1},
          attributes: []
        }]
      })).addressId
    } else {
      minerId = (await this.TransactionOutput.findOne({
        where: {outputIndex: 0},
        attributes: ['addressId'],
        include: [{
          model: this.Transaction,
          as: 'outputTransaction',
          required: true,
          where: {blockHeight: header.height, indexInBlock: 0},
          attributes: []
        }]
      })).addressId
    }
    return await this.Block.create({
      hash: rawBlock.hash,
      height: header.height,
      size: rawBlock.size,
      weight: rawBlock.weight,
      minerId,
      transactionsCount: rawBlock.transactionsCount,
      contractTransactionsCount: rawBlock.contractTransactionsCount
    })
  }

  async _setTip(tip) {
    this.logger.debug('Block Service: setting tip to height:', tip.height)
    this.logger.debug('Block Service: setting tip to hash:', tip.hash.toString('hex'))
    this._tip = tip
    await this.node.updateServiceTip(this.name, tip)
  }

  async _logSynced() {
    if (this._reorging) {
      return
    }
    try {
      let diff = await this._getTimeSinceLastBlock()
      this.logger.info(
        'Block Service: the best block hash is:', this._tip.hash.toString('hex'),
        'at height:', `${this._tip.height}.`,
        'Block interval:', diff
      )
    } catch (err) {
      this._handleError(err)
    }
  }

  async _onSynced() {
    if (this._reportInterval) {
      clearInterval(this._reportInterval)
    }
    this._logProgress()
    this._initialSync = false
    this._startBlockSubscription()
    this._logSynced(this._tip.hash)
    for (let service of this.node.getServicesByOrder()) {
      await service.onSynced()
    }
  }

  async _startSync() {
    let numNeeded = Math.max(this._header.getLastHeader().height - this._tip.height, 0)
    this.logger.info('Block Service: gathering:', numNeeded, 'block(s) from the peer-to-peer network')
    if (numNeeded > 0) {
      this.on('next block', this._sync.bind(this))
      this.on('synced', this._onSynced.bind(this))
      clearInterval(this._reportInterval)
      if (this._tip.height === 0) {
        let genesisBlock = Block.fromBuffer(this.chain.genesis)
        genesisBlock.height = 0
        await this._saveBlock(genesisBlock)
      }
      this._reportInterval = setInterval(this._logProgress.bind(this), 5000)
      this._reportInterval.unref()
      await this._sync()
    } else {
      this._onSynced()
    }
  }

  async _sync() {
    if (this.node.stopping || this._reorging) {
      return
    }
    this._processingBlock = true
    this.logger.debug('Block Service: querying header service for next block using tip:', this._tip.hash.toString('hex'))
    try {
      let {targetHash, endHash} = await this._header.getEndHash(this._tip, this._readAheadBlockCount)
      if (!targetHash && !endHash) {
        this._processingBlock = false
        this.emit('synced')
      } else {
        this.node.clearInventoryCache()
        this._getBlocksTimer = setTimeout(() => {
          this.logger.debug('Block Service: block timeout, emitting for next block')
          this._processingBlock = false
          if (!this._reorging) {
            this.emit('next block')
          }
        }, 5000)
        this._getBlocksTimer.unref()
        let block = await this.node.getP2PBlock({
          filter: {startHash: this._tip.hash, endHash},
          blockHash: targetHash
        })
        await this._syncBlock(block)
      }
    } catch (err) {
      this._processingBlock = false
      throw err
    }
  }

  _logProgress() {
    if (!this._initialSync) {
      return
    }
    let bestHeight = Math.max(this.node.getBestHeight(), this._tip.height)
    let progress = bestHeight && (this._tip.height / bestHeight * 100).toFixed(4)
    this.logger.info(
      'Block Service: download progress:',
      `${this._tip.height}/${bestHeight} (${progress}%)`
    )
  }
}

function convertSecondsToHumanReadable(seconds) {
  let result = ''
  let minutes
  if (seconds >= 60) {
    minutes = Math.floor(seconds / 60)
    seconds %= 60
  }
  if (minutes) {
    result = `${minutes} minute(s) `
  }
  if (seconds) {
    result += `${seconds} seconds`
  }
  return result
}
