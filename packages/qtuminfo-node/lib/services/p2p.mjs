import LRU from 'lru-cache'
import {Transaction} from 'qtuminfo-lib'
import {Pool, Messages, Inventory} from 'qtuminfo-p2p'
import Service from './base'

export default class P2PService extends Service {
  constructor(options) {
    super(options)
    this._options = options
    this._initP2P()
    this._initPubSub()
    this._currentBestHeight = null
    this._outgoingTransactions = LRU(100)
    this._blockCache = options.blockCacheCount || LRU({max: 10, maxAge: 5 * 60 * 1000})
  }

  get APIMethods() {
    return {
      clearInventoryCache: this.clearInventoryCache.bind(this),
      getP2PBlock: this.getP2PBlock.bind(this),
      getHeaders: this.getHeaders.bind(this),
      getMempool: this.getMempool.bind(this),
      getConnections: this.getConnections.bind(this),
      sendTransaction: this.sendTransaction.bind(this)
    }
  }

  clearInventoryCache() {
    this._inventories.reset()
  }

  getConnections() {
    return this._pool.connections
  }

  async getP2PBlock({blockHash, filter}) {
    let block = this._blockCache.get(blockHash)
    if (block) {
      return block
    }
    let blockFilter = this._setResourceFilter(filter, 'blocks')
    this._peer.sendMessage(this._messages.getblocks(blockFilter))
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
    this._peer.sendMessage(this._messages.getheaders(headerFilter))
  }

  getMempool() {
    this._peer.sendMessage(this._messages.mempool())
  }

  sendTransaction(tx) {
    let transaction = Transaction.fromBuffer(tx)
    let id = transaction.id
    this.logger.info('P2P service: sending transaction:', id.toString('hex'))
    this._outgoingTransactions.set(id.toString('hex'), transaction)
    let inventory = Inventory.forTransaction(id)
    let message = this._messages.inv({inventories: [inventory]})
    this._peer.sendMessage(message)
    this._onPeerTransaction(this._peer, {transaction})
    return id
  }

  async start() {
    this._initCache()
    this._initPool()
    this._setListeners()
  }

  _disconnectPool() {
    this.logger.info('P2P Service: diconnecting pool and peers. SIGINT issued, system shutdown initiated')
    this._pool.disconnect()
  }

  _addPeer(peer) {
    this._peers.push(peer)
  }

  _broadcast(subscribers, name, entity) {
    for (let emitter of subscribers) {
      emitter.emit(name, entity)
    }
  }

  _setRetryInterval() {
    if (!this._retryInterval && !this.node.stopping) {
      this._retryInterval = setInterval(() => {
        this.logger.info('P2P Service: retry connection to p2p network')
        this._pool.connect()
      }, 5000)
    }
  }

  _connect() {
    this.logger.info('P2P Service: connecting to p2p network')
    this._pool.connect()
    this._setRetryInterval()
  }

  _getBestHeight() {
    if (this._peers.length === 0) {
      return 0
    }
    let maxHeight = -Infinity
    for (let peer of this._peers) {
      if (peer.bestHeight > maxHeight) {
        maxHeight = peer.bestHeight
        this._peer = peer
      }
    }
    return maxHeight
  }

  _initCache() {
    this._inventories = LRU(1000)
  }

  _initP2P() {
    this._maxPeers = this._options.maxPeers || 60
    this._configPeers = this._options.peers
    this._messages = new Messages({chain: this.chain})
    this._peers = []
  }

  _initPool() {
    let options = {dnsSeed: false, maxPeers: this._maxPeers, chain: this.chain}
    if (this._configPeers) {
      options.addresses = this._configPeers
    }
    this._pool = new Pool(options)
  }

  _initPubSub() {
    this.subscriptions = {
      block: [],
      headers: [],
      transaction: []
    }
  }

  _onPeerBlock(peer, message) {
    this._blockCache.set(message.block.id, message.block)
    this.emit(message.block.id, message.block)
    this._broadcast(this.subscriptions.block, 'p2p/block', message.block)
  }

  _onPeerDisconnect(peer, address) {
    this._removePeer(peer)
    if (this._peers.length === 0) {
      this._setRetryInterval()
    }
    this.logger.info('P2P Service: disconnected from peer:', address.ip.v4)
  }

  _onPeerGetData(peer, message) {
    let txId = Buffer.from(message.inventory[0].data)
      .reverse()
      .toString('hex')
    let tx = this._outgoingTransactions.get(txId)
    if (tx) {
      peer.sendMessage(this._messages.tx({transaction: tx}))
    }
  }

  _onPeerHeaders(peer, message) {
    this._broadcast(this.subscriptions.headers, 'p2p/headers', message.headers)
  }

  _onPeerInventories(peer, message) {
    let newDataNeeded = []
    for (let inventory of message.inventories) {
      if (!this._inventories.get(inventory.data.toString('hex'))) {
        this._inventories.set(inventory.data.toString('hex'), true)
        if ([
          Inventory.types.TRANSACTION, Inventory.types.BLOCK, Inventory.types.FILTERED_BLOCK
        ].includes(inventory.type)) {
          inventory.type |= Inventory.types.WITNESS
        }
        newDataNeeded.push(inventory)
      }
    }
    if (newDataNeeded.length > 0) {
      peer.sendMessage(this._messages.getdata({inventories: newDataNeeded}))
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
    if (this._retryInterval) {
      clearInterval(this._retryInterval)
      this._retryInterval = null
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
    this._peers.splice(this._peers.indexOf(peer), 1)
  }

  _setListeners() {
    this.node.on('stopping', this._disconnectPool.bind(this))
    this._pool.on('peerready', this._onPeerReady.bind(this))
    this._pool.on('peerdisconnect', this._onPeerDisconnect.bind(this))
    this._pool.on('peerinv', this._onPeerInventories.bind(this))
    this._pool.on('peertx', this._onPeerTransaction.bind(this))
    this._pool.on('peerblock', this._onPeerBlock.bind(this))
    this._pool.on('peerheaders', this._onPeerHeaders.bind(this))
    this._pool.on('peergetdata', this._onPeerGetData.bind(this))
    this.node.on('ready', this._connect.bind(this))
  }

  _setResourceFilter(filter) {
    return {starts: [filter.startHash], stop: filter.endHash || 0}
  }
}
