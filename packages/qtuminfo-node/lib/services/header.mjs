import assert from 'assert'
import {Header as RawHeader} from 'qtuminfo-lib'
import Header from '../models/header'
import Service from './base'
import {AsyncQueue} from '../utils'

const MAX_CHAINWORK = 1n << 256n
const STARTING_CHAINWORK = 0x10001n

export default class HeaderService extends Service {
  constructor(options) {
    super(options)
    this._p2p = this.node.services.get('p2p')
    this._tip = null
    this._hashes = []
    this.subscriptions = {block: []}
    this._checkpoint = options.checkpoint || 2000
    this._genesisHeader = RawHeader.fromBuffer(this.chain.genesis)
    this._lastHeader = null
    this._initialSync = true
    this._originalHeight = 0
    this._lastHeaderCount = 2000
  }

  static get dependencies() {
    return ['db', 'p2p']
  }

  get APIMethods() {
    return {
      getBestHeight: this.getBestHeight.bind(this),
      getBlockHeader: this.getBlockHeader.bind(this)
    }
  }

  getBestHeight() {
    return this._tip.height
  }

  async getBlockHeader(arg) {
    if (typeof arg === 'number') {
      return await Header.findOne({height: arg})
    } else {
      return await Header.findOne({hash: arg})
    }
  }

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    this._adjustTipBackToCheckpoint()
    if (this._tip.height === 0) {
      await this._setGenesisBlock()
    }
    await this._adjustHeadersForCheckpointTip()
    this._blockProcessor = new AsyncQueue(this._processBlocks.bind(this))
    this._p2p.on('bestHeight', this._onBestHeight.bind(this))
    this._bus = this.node.openBus({remoteAddress: 'localhost-header'})
  }

  _adjustTipBackToCheckpoint() {
    this._originalHeight = this._tip.height
    if (this._checkpoint === -1 || this._tip.height < this._checkpoint) {
      this._tip.height = 0
      this._tip.hash = this._genesisHeader.hash
    } else {
      this._tip.height -= this._checkpoint
    }
  }

  async _setGenesisBlock() {
    assert(
      Buffer.compare(this._tip.hash, this._genesisHeader.hash) === 0,
      'Expected tip hash to be genesis hash, but it was not'
    )
    await Header.deleteMany()
    this._lastHeader = await Header.create({
      hash: this._genesisHeader.hash,
      height: 0,
      ...this._genesisHeader,
      chainwork: STARTING_CHAINWORK
    })
  }

  _startHeaderSubscription() {
    if (this._subscribedHeaders) {
      return
    }
    this._subscribedHeaders = true
    this.logger.info('Header Service: subscribe to p2p headers')
    this._bus.on('p2p/headers', this._onHeaders.bind(this))
    this._bus.subscribe('p2p/headers')
  }

  _queueBlock(block) {
    this._blockProcessor.push(block, err => {
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
    if (this.node.stopping || this._reorging) {
      return
    }
    try {
      let header = await this.getBlockHeader(block.hash)
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
    this._reorging = true
    this.emit('reorg')
    await this._handleReorg(block)
    this._startSync()
  }

  async _syncBlock(block) {
    this.logger.debug('Header Service: new block:', block.hash.toString('hex'))
    let header = new Header({hash: block.header.hash, ...block.header})
    this._onHeader(header)
    await header.save()
    await this.node.updateServiceTip(this.name, this._tip)
  }

  _broadcast(block) {
    for (let emitter of this.subscriptions.block) {
      emitter.emit('header/block', block)
    }
  }

  _onHeader(header) {
    header.height = this._lastHeader.height + 1
    header.chainwork = this._getChainwork(header, this._lastHeader)
    header.interval = header.timestamp - this._lastHeader.timestamp
    this._lastHeader = header
    this._tip.height = header.height
    this._tip.hash = header.hash
  }

  async _onHeaders(headers) {
    try {
      this._lastHeaderCount = headers.length
      if (headers.length === 0) {
        this._onHeadersSave().catch(err => this._handleError(err))
      } else {
        this.logger.debug('Header Service: received:', headers.length, 'header(s)')
        let transformedHeaders = headers.map(header => new Header({hash: header.hash, ...header}))
        for (let header of transformedHeaders) {
          assert(
            Buffer.compare(this._lastHeader.hash, header.prevHash) === 0,
            `headers not in order: ${this._lastHeader.hash.toString('hex')}' -and- ${header.prevHash.toString('hex')},`,
            `last header at height: ${this._lastHeader.height}`
          )
          this._onHeader(header)
        }
        await Header.insertMany(transformedHeaders, {ordered: false})
      }
      await this.node.updateServiceTip(this.name, this._tip)
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
    this.logger.debug('Header Service:', this._lastHeader.hash.toString('hex'), 'is the best block hash')
    if (!this._initialSync) {
      return
    }
    this.logger.info('Header Service: sync complete')
    this._initialSync = false
    for (let service of this.node.getServicesByOrder()) {
      await service.onHeaders()
    }
    this.emit('reorg complete')
    this._reorging = false
  }

  _stopHeaderSubscription() {
    if (this._subscribedHeaders) {
      this._subscribedHeaders = false
      this.logger.info('Header Service: p2p header subscription no longer needed, unsubscribing')
      this._bus.unsubscribe('p2p/headers')
    }
  }

  _startBlockSubscription() {
    if (!this._subscribedBlock) {
      this._subscribedBlock = true
      this.logger.info('Header Service: starting p2p block subscription')
      this._bus.on('p2p/block', this._queueBlock.bind(this))
      this._bus.subscribe('p2p/block')
    }
  }

  get _syncComplete() {
    return this._lastHeaderCount < 2000
  }

  _detectReorg(block) {
    return Buffer.compare(this._lastHeader.hash, block.header.prevHash) !== 0
  }

  async _handleReorg(block) {
    this.logger.warn(
      `Header Service: reorganization detected, current tip hash: ${this._tip.hash.toString('hex')},`,
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
    this._initialSync = true
    this.logger.debug('Header Service: starting sync routines, ensuring no pre-exiting subscriptions to p2p blocks')
    this._removeAllSubscriptions()
    let interval = setInterval(() => {
      if (this._blockProcessor.length === 0) {
        clearInterval(interval)
        let numNeeded = Math.max(this._bestHeight, this._originalHeight) - this._tip.height
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
    this._bus.unsubscribe('p2p/headers')
    this._bus.unsubscribe('p2p/block')
    this._subscribedBlock = false
    this._subscribedHeaders = false
    this._bus.removeAllListeners()
  }

  _logProcess() {
    if (!this._initialSync || this._lastTipHeightReported === this._tip.height) {
      return
    }
    let bestHeight = Math.max(this._bestHeight, this._lastHeader.height)
    let progress = bestHeight === 0 ? 0 : (this._tip.height / bestHeight * 100).toFixed(2)
    this.logger.info(
      'Header Service: download progress:',
      `${this._tip.height}/${bestHeight}`,
      `(${progress}%)`
    )
    this._lastTipHeightReported = this._tip.height
  }

  _getP2PHeaders(hash) {
    this.node.getHeaders({startHash: hash})
  }

  _sync() {
    this._startHeaderSubscription()
    this._getP2PHeaders(this._tip.hash)
  }

  async getEndHash(tip, blockCount) {
    assert(blockCount >= 1, 'Header Service: block count to getEndHash must be at least 1')
    let numResultsNeeded = Math.min(this._tip.height - tip.height, blockCount + 1)
    if (numResultsNeeded === 0 && Buffer.compare(this._tip.hash, tip.hash) === 0) {
      return
    } else if (numResultsNeeded <= 0) {
      throw new Error('Header Service: block service is mis-aligned')
    }
    let startingHeight = tip.height + 1
    let results = await Header.collection
      .find(
        {height: {$gte: startingHeight, $lte: startingHeight + blockCount}},
        {projection: {_id: false, hash: true}}
      )
      .map(document => Buffer.from(document.hash, 'hex'))
      .toArray()
    let index = numResultsNeeded - 1
    let endHash = index <= 0 || !results[index] ? 0 : results[index]
    return {targetHash: results[0], endHash}
  }

  getLastHeader() {
    return this._lastHeader
  }

  async _adjustHeadersForCheckpointTip() {
    this.logger.info('Header Service: getiing last header synced at height:', this._tip.height)
    await Header.deleteMany({height: {$gt: this._tip.height}})
    this._lastHeader = await Header.findOne({height: this._tip.height})
    this._tip.height = this._lastHeader.height
    this._tip.hash = this._lastHeader.hash
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
