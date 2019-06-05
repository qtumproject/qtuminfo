import assert from 'assert'
import Sequelize from 'sequelize'
import {Header} from 'qtuminfo-lib'
import Service from './base'
import {AsyncQueue} from '../utils'

const {gt: $gt, between: $between} = Sequelize.Op

const MAX_CHAINWORK = 1n << 256n
const STARTING_CHAINWORK = 0x100010001n

export default class HeaderService extends Service {
  #p2p = null
  #tip = null
  #checkpoint = 2000
  #genesisHeader = null
  #lastHeader = null
  #initialSync = true
  #originalHeight = 0
  #lastHeaderCount = 2000
  #bus = null
  #reorging = false
  #blockProcessor = null
  #subscribedHeaders = false
  #lastTipHeightReported = null

  constructor(options) {
    super(options)
    this.#p2p = this.node.services.get('p2p')
    this.subscriptions = {block: []}
    this.#checkpoint = options.checkpoint || 2000
    this.#genesisHeader = Header.fromBuffer(this.chain.genesis)
  }

  static get dependencies() {
    return ['db', 'p2p']
  }

  get APIMethods() {
    return {getBestHeight: this.getBestHeight.bind(this)}
  }

  getBestHeight() {
    return this.#tip.height
  }

  async start() {
    this.Header = this.node.getModel('header')
    this.#tip = await this.node.getServiceTip(this.name)
    this._adjustTipBackToCheckpoint()
    if (this.#tip.height === 0) {
      await this._setGenesisBlock()
    }
    await this._adjustHeadersForCheckpointTip()
    this.#blockProcessor = new AsyncQueue(this._processBlocks.bind(this))
    this.#p2p.on('bestHeight', this._onBestHeight.bind(this))
    this.#bus = this.node.openBus({remoteAddress: 'localhost-header'})
  }

  _adjustTipBackToCheckpoint() {
    this.#originalHeight = this.#tip.height
    if (this.#checkpoint === -1 || this.#tip.height < this.#checkpoint) {
      this.#tip.height = 0
      this.#tip.hash = this.#genesisHeader.hash
    } else {
      this.#tip.height -= this.#checkpoint
    }
  }

  async _setGenesisBlock() {
    assert(
      Buffer.compare(this.#tip.hash, this.#genesisHeader.hash) === 0,
      'Expected tip hash to be genesis hash, but it was not'
    )
    await this.Header.destroy({truncate: true})
    this.#lastHeader = await this.Header.create({
      hash: this.#genesisHeader.hash,
      height: 0,
      ...this.#genesisHeader,
      chainwork: STARTING_CHAINWORK
    })
  }

  _startHeaderSubscription() {
    if (this.#subscribedHeaders) {
      return
    }
    this.#subscribedHeaders = true
    this.logger.info('Header Service: subscribe to p2p headers')
    this.#bus.on('p2p/headers', this._onHeaders.bind(this))
    this.#bus.subscribe('p2p/headers')
  }

  _queueBlock(block) {
    this.#blockProcessor.push(block, err => {
      if (err) {
        this._handleError(err)
      } else {
        this.logger.debug(
          `Header Service: completed processing block: ${block.hash.toString('hex')},`,
          'prev hash:', block.header.prevHash.toString('hex')
        )
      }
    })
  }

  async _processBlocks(block) {
    if (this.node.stopping || this.#reorging) {
      return
    }
    try {
      let header = await this.Header.findByHash(block.hash)
      if (header) {
        this.logger.debug('Header Service: block already exists in data set')
      } else {
        await this._persistHeader(block)
      }
    } catch (err) {
      this._handleError(err)
    }
  }

  async _persistHeader(block) {
    if (!this._detectReorg(block)) {
      await this._syncBlock(block)
      return
    }
    this.#reorging = true
    this.emit('reorg')
    await this._handleReorg(block)
    this._startSync()
  }

  async _syncBlock(block) {
    this.logger.debug('Header Service: new block:', block.hash.toString('hex'))
    let header = new this.Header({hash: block.header.hash, ...block.header})
    this._onHeader(header)
    await header.save()
    await this.node.updateServiceTip(this.name, this.#tip)
  }

  _broadcast(block) {
    for (let emitter of this.subscriptions.block) {
      emitter.emit('header/block', block)
    }
  }

  _onHeader(header) {
    header.height = this.#lastHeader.height + 1
    header.chainwork = this._getChainwork(header, this.#lastHeader)
    this.#lastHeader = header
    this.#tip.height = header.height
    this.#tip.hash = header.hash
  }

  async _onHeaders(headers) {
    try {
      this.#lastHeaderCount = headers.length
      if (headers.length === 0) {
        this._onHeadersSave().catch(err => this._handleError(err))
      } else {
        this.logger.debug('Header Service: received:', headers.length, 'header(s)')
        let transformedHeaders = headers.map(header => ({
          hash: header.hash,
          version: header.version,
          prevHash: header.prevHash,
          merkleRoot: header.merkleRoot,
          timestamp: header.timestamp,
          bits: header.bits,
          nonce: header.nonce,
          hashStateRoot: header.hashStateRoot,
          hashUTXORoot: header.hashUTXORoot,
          stakePrevTxId: header.stakePrevTxId,
          stakeOutputIndex: header.stakeOutputIndex,
          signature: header.signature
        }))
        for (let header of transformedHeaders) {
          assert(
            Buffer.compare(this.#lastHeader.hash, header.prevHash) === 0,
            `headers not in order: ${this.#lastHeader.hash.toString('hex')}' -and- ${header.prevHash.toString('hex')},`,
            `last header at height: ${this.#lastHeader.height}`
          )
          this._onHeader(header)
        }
        await this.Header.bulkCreate(transformedHeaders)
      }
      await this.node.updateServiceTip(this.name, this.#tip)
      await this._onHeadersSave()
    } catch (err) {
      this._handleError(err)
    }
  }

  _handleError(err) {
    this.logger.error('Header Service:', err)
    this.node.stop()
  }

  async _onHeadersSave() {
    this._logProcess()
    if (!this._syncComplete) {
      this._sync()
      return
    }
    this._stopHeaderSubscription()
    this._startBlockSubscription()
    this.logger.debug('Header Service:', this.#lastHeader.hash.toString('hex'), 'is the best block hash')
    if (!this.#initialSync) {
      return
    }
    this.logger.info('Header Service: sync complete')
    this.#initialSync = false
    for (let service of this.node.getServicesByOrder()) {
      await service.onHeaders()
    }
    this.emit('reorg complete')
    this.#reorging = false
  }

  _stopHeaderSubscription() {
    if (this.#subscribedHeaders) {
      this.#subscribedHeaders = false
      this.logger.info('Header Service: p2p header subscription no longer needed, unsubscribing')
      this.#bus.unsubscribe('p2p/headers')
    }
  }

  _startBlockSubscription() {
    if (!this._subscribedBlock) {
      this._subscribedBlock = true
      this.logger.info('Header Service: starting p2p block subscription')
      this.#bus.on('p2p/block', this._queueBlock.bind(this))
      this.#bus.subscribe('p2p/block')
    }
  }

  get _syncComplete() {
    return this.#lastHeaderCount < 2000
  }

  _detectReorg(block) {
    return Buffer.compare(this.#lastHeader.hash, block.header.prevHash) !== 0
  }

  async _handleReorg(block) {
    this.logger.warn(
      `Header Service: reorganization detected, current tip hash: ${this.#tip.hash.toString('hex')},`,
      'new block causing the reorg:', block.hash.toString('hex')
    )
    this._adjustTipBackToCheckpoint()
    await this._adjustHeadersForCheckpointTip()
  }

  _onBestHeight(height) {
    this.logger.info('Header Service: best height is:', height)
    this._bestHeight = height
    this._startSync()
  }

  _startSync() {
    this.#initialSync = true
    this.logger.debug('Header Service: starting sync routines, ensuring no pre-exiting subscriptions to p2p blocks')
    this._removeAllSubscriptions()
    let interval = setInterval(() => {
      if (this.#blockProcessor.length === 0) {
        clearInterval(interval)
        let numNeeded = Math.max(this._bestHeight, this.#originalHeight) - this.#tip.height
        assert(numNeeded >= 0)
        if (numNeeded > 0) {
          this.logger.info('Header Service: gathering:', numNeeded, 'header(s) from the peer-to-peer network')
          this._sync()
        } else if (numNeeded === 0) {
          this.logger.info('Header Service: we seem to be already synced with the peer')
        }
      }
    }, 0)
  }

  _removeAllSubscriptions() {
    this.#bus.unsubscribe('p2p/headers')
    this.#bus.unsubscribe('p2p/block')
    this._subscribedBlock = false
    this.#subscribedHeaders = false
    this.#bus.removeAllListeners()
  }

  _logProcess() {
    if (!this.#initialSync || this.#lastTipHeightReported === this.#tip.height) {
      return
    }
    let bestHeight = Math.max(this._bestHeight, this.#lastHeader.height)
    let progress = bestHeight === 0 ? 0 : (this.#tip.height / bestHeight * 100).toFixed(2)
    this.logger.info(
      'Header Service: download progress:',
      `${this.#tip.height}/${bestHeight}`,
      `(${progress}%)`
    )
    this.#lastTipHeightReported = this.#tip.height
  }

  _getP2PHeaders(hash) {
    this.node.getHeaders({startHash: hash})
  }

  _sync() {
    this._startHeaderSubscription()
    this._getP2PHeaders(this.#tip.hash)
  }

  async getEndHash(tip, blockCount) {
    assert(blockCount >= 1, 'Header Service: block count to getEndHash must be at least 1')
    let numResultsNeeded = Math.min(this.#tip.height - tip.height, blockCount + 1)
    if (numResultsNeeded === 0 && Buffer.compare(this.#tip.hash, tip.hash) === 0) {
      return
    } else if (numResultsNeeded <= 0) {
      throw new Error('Header Service: block service is mis-aligned')
    }
    let startingHeight = tip.height + 1
    let results = (await this.Header.findAll({
      where: {height: {[$between]: [startingHeight, startingHeight + blockCount]}},
      attributes: ['hash']
    })).map(header => header.hash)
    let index = numResultsNeeded - 1
    let endHash = index <= 0 || !results[index] ? 0 : results[index]
    return {targetHash: results[0], endHash}
  }

  getLastHeader() {
    return this.#lastHeader
  }

  async _adjustHeadersForCheckpointTip() {
    this.logger.info('Header Service: getting last header synced at height:', this.#tip.height)
    await this.Header.destroy({where: {height: {[$gt]: this.#tip.height}}})
    this.#lastHeader = await this.Header.findByHeight(this.#tip.height)
    this.#tip.height = this.#lastHeader.height
    this.#tip.hash = this.#lastHeader.hash
  }

  _getChainwork(header, prevHeader) {
    let target = fromCompact(header.bits)
    if (target <= 0n) {
      return 0n
    }
    return prevHeader.chainwork + MAX_CHAINWORK / (target + 1n)
  }
}

function fromCompact(bits) {
  if (bits === 0) {
    return 0n
  }
  let exponent = bits >>> 24
  let num = BigInt(bits & 0x7fffff) << BigInt(8 * (exponent - 3))
  if (bits >>> 23 & 1) {
    num = -num
  }
  return num
}
