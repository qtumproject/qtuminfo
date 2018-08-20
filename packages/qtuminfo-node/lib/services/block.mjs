import assert from 'assert'
import LRU from 'lru-cache'
import {Header as RawHeader, Block as RawBlock, Address} from 'qtuminfo-lib'
import Header from '../models/header'
import Block from '../models/block'
import TransactionOutput from '../models/transaction-output'
import Service from './base'
import {AsyncQueue, Buffer32toBigInt, toBigInt} from '../utils'

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
      getBlock: this.getBlock.bind(this),
      getRawBlock: this.getRawBlock.bind(this),
      syncPercentage: this.syncPercentage.bind(this),
      isSynced: this.isSynced.bind(this)
    }
  }

  isSynced() {
    return !this._initialSync
  }

  getTip() {
    return this._tip
  }

  async getBlock(arg) {
    let filter = Number.isInteger(arg) ? {height: arg} : {hash: arg.toString('hex')}
    let [block] = await Block.aggregate([
      {$match: filter},
      {
        $lookup: {
          from: 'headers',
          localField: 'hash',
          foreignField: 'hash',
          as: 'header'
        }
      },
      {$addFields: {header: {$arrayElemAt: ['$header', 0]}}}
    ])
    if (!block) {
      return null
    }
    let result = {
      hash: Buffer.from(block.hash, 'hex'),
      height: block.height,
      version: block.header.version,
      prevHash: Buffer.from(block.prevHash, 'hex'),
      merkleRoot: block.header.merkleRoot.buffer,
      timestamp: block.timestamp,
      bits: block.header.bits,
      nonce: block.header.nonce,
      hashStateRoot: block.header.hashStateRoot.buffer,
      hashUTXORoot: block.header.hashUTXORoot.buffer,
      prevOutStakeHash: block.header.prevOutStakeHash.buffer,
      prevOutStakeN: block.header.prevOutStakeN,
      signature: block.header.signature.buffer,
      chainwork: Buffer32toBigInt(block.header.chainwork.buffer),
      size: block.size,
      weight: block.weight,
      transactions: block.transactions.map(id => Buffer.from(id, 'hex')),
      miner: new Address({
        type: block.miner.type,
        data: Buffer.from(block.miner.hex, 'hex'),
        chain: this.chain
      }),
      coinStakeValue: block.coinStakeValue && toBigInt(block.coinStakeValue),
      isProofOfStake: RawHeader.prototype.isProofOfStake.call({
        prevOutStakeHash: block.header.prevOutStakeHash.buffer,
        prevOutStakeN: block.header.prevOutStakeN
      }),
      difficulty: new RawHeader({bits: block.header.bits}).difficulty
    }
    let nextBlock = await Header.collection.findOne(
      {height: block.height + 1},
      {projection: {_id: false, hash: true}}
    )
    result.nextHash = nextBlock && Buffer.from(nextBlock.hash, 'hex')
    return result
  }

  async getRawBlock(hash) {
    let [block] = await this.aggregate([
      {$match: {hash: hash.toString('hex')}},
      {
        $lookup: {
          from: 'headers',
          localField: 'hash',
          foreignField: 'hash',
          as: 'header'
        }
      },
      {$addFields: {header: {$arrayElemAt: ['$header', 0]}}}
    ])
    if (!block) {
      return null
    }
    let transactions = []
    for (let txid of block.transactions) {
      transactions.push(await this.node.getRawTransaction(Buffer.from(txid, 'hex')))
    }
    return new RawBlock({
      header: new RawHeader({
        hash: Buffer.from(block.hash, 'hex'),
        height: block.height,
        version: block.header.version,
        prevHash: Buffer.from(block.prevHash, 'hex'),
        merkleRoot: block.header.merkleRoot.buffer,
        timestamp: block.header.timestamp,
        bits: block.header.bits,
        nonce: block.header.nonce,
        hashStateRoot: block.header.hashStateRoot.buffer,
        hashUTXORoot: block.header.hashUTXORoot.buffer,
        prevOutStakeHash: block.header.prevOutStakeHash.buffer,
        prevOutStakeN: block.header.prevOutStakeN,
        signature: block.header.signature.buffer
      }),
      transactions
    })
  }

  async _checkTip() {
    this.logger.info('Block Service: checking the saved tip...')
    let header = await this.node.getBlockHeader(this._tip.height) || this._header.getLastHeader()
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
      block = await Block.findOne({hash: hash.toString('hex')}, '-_id hash', {lean: true})
      if (block) {
        hash = Buffer.from(block.hash, 'hex')
      } else {
        this.logger.debug('Block Service: block:', hash.toString('hex'), 'was not found, proceeding to older blocks')
      }
      let header = await Block.findOne({height: --height}, '-_id hash')
      assert(header, 'Header not found for reset')
      if (!block) {
        this.logger.debug('Block Service: trying block:', header.hash.toString('hex'))
      }
    } while (!block)
    await this._setTip({height: height + 1, hash})
  }

  async start() {
    let tip = await this.node.getServiceTip('block')
    if (tip.height > 0 && !await Block.findOne({hash: tip.hash.toString('hex')}, '_id', {lean: true})) {
      tip = null
    }
    this._blockProcessor = new AsyncQueue(this._onBlock.bind(this))
    this._bus = this.node.openBus({remoteAddress: 'localhost-block'})
    if (!tip) {
      this._tipResetNeeded = true
      return
    }
    await Block.deleteMany({height: {$gt: tip.height}})
    this._header.on('reorg', () => {this._reorging = true})
    this._header.on('reorg complete', () => {this._reorging = false})
    await this._setTip(tip)
    await this._loadRecentBlockHashes()
  }

  async _loadRecentBlockHashes() {
    let hashes = await Block.collection
      .find(
        {height: {$gte: this._tip.height - this._recentBlockHashesCount, $lte: this._tip.height}},
        {projection: {_id: false, hash: true}}
      )
      .map(document => document.hash)
      .toArray()
    for (let i = 0; i < hashes.length - 1; ++i) {
      this._recentBlockHashes.set(hashes[i + 1], Buffer.from(hashes[i], 'hex'))
    }
    this.logger.info('Block Service: loaded:', this._recentBlockHashes.length, 'hashes from the index')
  }

  async _getTimeSinceLastBlock() {
    let header = await Block.findOne({height: Math.max(this._tip.height - 1, 0)}, '-_id timestamp', {lean: true})
    let tip = await Block.findOne({hash: this._tip.hash.toString('hex')}, '-_id timestamp', {lean: true})
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

  syncPercentage() {
    let height = this._header.getLastHeader().height
    let ratio = this._tip.height / height
    return (ratio * 100).toFixed(2)
  }

  async onReorg(height) {
    await Block.deleteMany({height: {$gt: height}})
  }

  async _onReorg(blocks) {
    let targetHeight = blocks[blocks.length - 1].height - 1
    let {hash: targetHash} = await Block.findOne({height: targetHeight}, '-_id hash')
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
      let header = await this.node.getBlockHeader(this._reorgToBlock)
      assert(header, 'Block Service: header not found to reorg to')
      return header
    }
    let blockServiceHash = this._tip.hash
    let blockServiceHeight = this._tip.height
    let header
    for (let i = 0; i <= this._recentBlockHashes.length; ++i) {
      let currentHeader = await this.node.getBlockHeader(blockServiceHash)
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
    for (let i = 0; i < this._recentBlockHashes.length && Buffer.compare(hash, commonHeader.hash) !== 0; ++i) {
      let block = await Block.findOne({hash}, '-_id hash height prevHash')
      blocks.push(block)
      hash = block.prevHash
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
      if (await Block.findOne({hash: rawBlock.hash}, '_id', {lean: true})) {
        this._processingBlock = false
        this.logger.debug('Block Service: not syncing, block already in database')
      } else {
        return await this._processBlock(rawBlock)
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
      let block = await this.__onBlock(rawBlock)
      this._recentBlockHashes.set(rawBlock.hash.toString('hex'), rawBlock.header.prevHash)
      await this._setTip({hash: rawBlock.hash, height: rawBlock.height})
      this._processingBlock = false
      for (let subscription of this.subscriptions.block) {
        subscription.emit('block/block', block)
      }
      // TODO subscriptions
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
      header = await Header.findOne({hash: rawBlock.hash}, '-_id height')
    } while (!header)
    let miner
    let coinStakeValue
    if (rawBlock.header.isProofOfStake()) {
      let kernel = rawBlock.transactions[1].inputs[0]
      let txo = await TransactionOutput.findOne({
        'output.transactionId': kernel.prevTxId.toString('hex'),
        'output.index': kernel.outputIndex
      }, '-_id address value')
      miner = {type: Address.PAY_TO_PUBLIC_KEY_HASH, data: txo.address.data}
      coinStakeValue = txo.value
    } else {
      let address = Address.fromScript(rawBlock.transactions[0].outputs[0].scriptPubKey)
      if (address.type === Address.PAY_TO_PUBLIC_KEY) {
        address.type = Address.PAY_TO_PUBLIC_KEY_HASH
      }
      miner = {type: address.type, hex: address.data}
    }
    return await Block.create({
      hash: rawBlock.hash,
      height: header.height,
      prevHash: rawBlock.header.prevHash,
      timestamp: rawBlock.header.timestamp,
      size: rawBlock.size,
      weight: rawBlock.weight,
      transactions: rawBlock.transactions.map(transaction => transaction.id),
      transactionCount: rawBlock.transactions.length,
      miner,
      ...coinStakeValue ? {coinStakeValue} : {}
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
        'Time between the last 2 blocks:', diff
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
        let genesisBlock = RawBlock.fromBuffer(this.chain.genesis)
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
