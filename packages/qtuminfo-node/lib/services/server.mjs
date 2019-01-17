import socketio from 'socket.io'
import Service from './base'

export default class ServerService extends Service {
  constructor(options) {
    super(options)
    this._options = options
  }

  static get dependencies() {
    return ['block', 'mempool']
  }

  async start() {
    this._bus = this.node.openBus({remoteAddress: 'localhost-server'})
    this._bus.on('block/block', this._onBlock.bind(this))
    this._bus.subscribe('block/block')
    this._bus.on('block/reorg', this._onMempoolTransaction.bind(this))
    this._bus.subscribe('block/reorg')
    this._bus.on('mempool/transaction', this._onMempoolTransaction.bind(this))
    this._bus.subscribe('mempool/transaction')

    this._io = socketio(this._options.port || 3001, {serveClient: false})
    this._io.on('connection', this._onConnection.bind(this))
  }

  async stop() {
    this._io.close()
  }

  _onConnection(socket) {
    socket.emit('tip', this.node.getBlockTip())
  }

  _onBlock(block) {
    this._io.sockets.emit('block', {hash: block.hash, height: block.height})
  }

  _onReorg(block) {
    this._io.sockets.emit('reorg', {hash: block.hash, height: block.height})
  }

  _onMempoolTransaction(transaction) {
    this._io.sockets.emit('mempool-transaction', transaction.id)
  }
}
