const LRU = require('lru-cache')
const {Pool, Messages, Inventory} = require('../../p2p')
const Service = require('./base')

class P2PService extends Service {
  #options = null
  #outgoingTransactions = new LRU(100)
  #blockCache = null
  #pool = null
  #peer = null
  #peers = []
  #inventories = null
  #maxPeers = 60
  #configPeers = []
  #messages = null
  #retryInterval = null

  constructor(options) {
    super(options)
    this.#options = options
    this._initP2P()
    this._initPubSub()
    this.#blockCache = options.blockCacheCount || new LRU({max: 10, maxAge: 5 * 60 * 1000})
  }

  static get dependencies() {
    return ['db']
  }

  get APIMethods() {
    return {
      clearInventoryCache: this.clearInventoryCache.bind(this),
      getP2PBlock: this.getP2PBlock.bind(this),
      getHeaders: this.getHeaders.bind(this),
      getMempool: this.getMempool.bind(this),
      getConnections: this.getConnections.bind(this),
      sendRawTransaction: this.sendRawTransaction.bind(this)
    }
  }

  clearInventoryCache() {
    this.#inventories.reset()
  }

  getConnections() {
    return this.#pool.connections
  }

  async getP2PBlock({blockHash, filter}) {
    let block = this.#blockCache.get(blockHash)
    if (block) {
      return block
    }
    let blockFilter = this._setResourceFilter(filter, 'blocks')
    this.#peer.sendMessage(this.#messages.getblocks(blockFilter))
    return new Promise((resolve, reject) => {
      let timeout
      let callback = block => {
        clearTimeout(timeout)
        resolve(block)
      }
      timeout = setTimeout(() => {
        this.removeListener(blockHash, callback)
        reject()
      }, 5000)
      this.once(blockHash, callback)
    })
  }

  getHeaders(filter) {
    let headerFilter = this._setResourceFilter(filter, 'headers')
    this.#peer.sendMessage(this.#messages.getheaders(headerFilter))
  }

  getMempool() {
    this.#peer.sendMessage(this.#messages.mempool())
  }

  async sendRawTransaction(data) {
    let id = await this.node.getRpcClient().sendrawtransaction(data.toString('hex'))
    return Buffer.from(id, 'hex')
  }

  async start() {
    this._initCache()
    this._initPool()
    this._setListeners()
  }

  _disconnectPool() {
    this.logger.info('P2P Service: diconnecting pool and peers. SIGINT issued, system shutdown initiated')
    this.#pool.disconnect()
  }

  _addPeer(peer) {
    this.#peers.push(peer)
  }

  _broadcast(subscribers, name, entity) {
    for (let emitter of subscribers) {
      emitter.emit(name, entity)
    }
  }

  _setRetryInterval() {
    if (!this.#retryInterval && !this.node.stopping) {
      this.#retryInterval = setInterval(() => {
        this.logger.info('P2P Service: retry connection to p2p network')
        this.#pool.connect()
      }, 5000).unref()
    }
  }

  _connect() {
    this.logger.info('P2P Service: connecting to p2p network')
    this.#pool.connect()
    this._setRetryInterval()
  }

  _getBestHeight() {
    if (this.#peers.length === 0) {
      return 0
    }
    let maxHeight = -Infinity
    for (let peer of this.#peers) {
      if (peer.bestHeight > maxHeight) {
        maxHeight = peer.bestHeight
        this.#peer = peer
      }
    }
    return maxHeight
  }

  _initCache() {
    this.#inventories = new LRU(1000)
  }

  _initP2P() {
    this.#maxPeers = this.#options.maxPeers || 60
    this.#configPeers = this.#options.peers
    this.#messages = new Messages({chain: this.chain})
    this.#peers = []
  }

  _initPool() {
    let options = {dnsSeed: false, maxPeers: this.#maxPeers, chain: this.chain}
    if (this.#configPeers) {
      options.addresses = this.#configPeers
    }
    this.#pool = new Pool(options)
  }

  _initPubSub() {
    this.subscriptions = {
      block: [],
      headers: [],
      transaction: []
    }
  }

  _onPeerBlock(peer, message) {
    this.#blockCache.set(message.block.id, message.block)
    this.emit(message.block.id, message.block)
    this._broadcast(this.subscriptions.block, 'p2p/block', message.block)
  }

  _onPeerDisconnect(peer, address) {
    this._removePeer(peer)
    if (this.#peers.length === 0) {
      this._setRetryInterval()
    }
    this.logger.info('P2P Service: disconnected from peer:', address.ip.v4)
  }

  _onPeerGetData(peer, message) {
    let txId = Buffer.from(message.inventory[0].data)
      .reverse()
      .toString('hex')
    let tx = this.#outgoingTransactions.get(txId)
    if (tx) {
      peer.sendMessage(this.#messages.tx({transaction: tx}))
    }
  }

  _onPeerHeaders(peer, message) {
    this._broadcast(this.subscriptions.headers, 'p2p/headers', message.headers)
  }

  _onPeerInventories(peer, message) {
    let newDataNeeded = []
    for (let inventory of message.inventories) {
      if (!this.#inventories.get(inventory.data.toString('hex'))) {
        this.#inventories.set(inventory.data.toString('hex'), true)
        if ([
          Inventory.types.TRANSACTION, Inventory.types.BLOCK, Inventory.types.FILTERED_BLOCK
        ].includes(inventory.type)) {
          inventory.type |= Inventory.types.WITNESS
        }
        newDataNeeded.push(inventory)
      }
    }
    if (newDataNeeded.length > 0) {
      peer.sendMessage(this.#messages.getdata({inventories: newDataNeeded}))
    }
  }

  _matchChain(chain) {
    if (this.chain.name === chain.name) {
      return chain
    }
    this.logger.error(
      `P2P Service: configured chain: "${this.chain.name}"`,
      `does not match our peer's reported network: "${chain.name}"`
    )
    this.node.stop()
  }

  _onPeerReady(peer, address) {
    if (this.#retryInterval) {
      clearInterval(this.#retryInterval)
      this.#retryInterval = null
    }
    if (!this._matchChain(peer.chain)) {
      return
    }
    this.logger.info(
      `Connected to peer: ${address.ip.v4},`,
      `chain: ${peer.chain.name}, version: ${peer.version},`,
      `subversion: ${peer.subversion},`,
      `status: ${peer.status},`,
      `port: ${peer.port},`,
      `best height: ${peer.bestHeight}`
    )
    this._addPeer(peer)
    let bestHeight = this._getBestHeight()
    if (bestHeight >= 0) {
      this.emit('bestHeight', bestHeight)
    }
  }

  _onPeerTransaction(peer, message) {
    this._broadcast(this.subscriptions.transaction, 'p2p/transaction', message.transaction)
  }

  _removePeer(peer) {
    this.#peers.splice(this.#peers.indexOf(peer), 1)
  }

  _setListeners() {
    this.node.on('stopping', this._disconnectPool.bind(this))
    this.#pool.on('peerready', this._onPeerReady.bind(this))
    this.#pool.on('peerdisconnect', this._onPeerDisconnect.bind(this))
    this.#pool.on('peerinv', this._onPeerInventories.bind(this))
    this.#pool.on('peertx', this._onPeerTransaction.bind(this))
    this.#pool.on('peerblock', this._onPeerBlock.bind(this))
    this.#pool.on('peerheaders', this._onPeerHeaders.bind(this))
    this.#pool.on('peergetdata', this._onPeerGetData.bind(this))
    this.node.on('ready', this._connect.bind(this))
  }

  _setResourceFilter(filter) {
    return {starts: [filter.startHash], stop: filter.endHash || 0}
  }
}

module.exports = P2PService
