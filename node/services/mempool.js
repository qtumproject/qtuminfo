const Sequelize = require('sequelize')
const Service = require('./base')
const {AsyncQueue, sql} = require('../utils')

const {in: $in} = Sequelize.Op

class MempoolService extends Service {
  subscriptions = {transaction: []}
  #transaction = null
  #subscribed = false
  #enabled = false
  #transactionProcessor = null
  #bus = null
  #db = null
  #Transaction = null
  #Witness = null

  constructor(options) {
    super(options)
    this.#transaction = this.node.services.get('transaction')
  }

  static get dependencies() {
    return ['db', 'p2p', 'transaction']
  }

  async start() {
    this.#db = this.node.getDatabase()
    this.#Transaction = this.node.getModel('transaction')
    this.#Witness = this.node.getModel('witness')
    this.#transactionProcessor = new AsyncQueue(this._onTransaction.bind(this))
  }

  _startSubscriptions() {
    if (this.#subscribed) {
      return
    }
    this.#subscribed = true
    if (!this.#bus) {
      this.#bus = this.node.openBus({remoteAddress: 'localhost-mempool'})
    }
    this.#bus.on('p2p/transaction', this._queueTransaction.bind(this))
    this.#bus.subscribe('p2p/transaction')
  }

  enable() {
    this.logger.info('Mempool Service: mempool enabled')
    this._startSubscriptions()
    this.#enabled = true
  }

  onSynced() {
    this.enable()
  }

  _queueTransaction(tx) {
    this.#transactionProcessor.push(tx, err => {
      if (err) {
        this._handleError(err)
      }
    })
  }

  _handleError(err) {
    if (!this.node.stopping) {
      this.logger.error('Mempool Service: handle error', err)
      this.node.stop()
    }
  }

  async _onTransaction(tx) {
    tx.blockHeight = 0xffffffff
    tx.indexInBlock = 0xffffffff
    try {
      if (!await this._validate(tx)) {
        return
      }
      await this.#transaction.removeReplacedTransactions(tx)
      tx._id = (await this.#Transaction.create({
        id: tx.id,
        hash: tx.hash,
        version: tx.version,
        flag: tx.flag,
        lockTime: tx.lockTime,
        blockHeight: 0xffffffff,
        indexInBlock: 0xffffffff,
        size: tx.size,
        weight: tx.weight
      }))._id
      let witnesses = this.#transaction.groupWitnesses(tx)
      await Promise.all([
        this.#Witness.bulkCreate(witnesses, {validate: false}),
        this.#transaction.processTxos([tx]),
      ])
      await this.#transaction.processBalanceChanges({transactions: [tx]})
      await this.#transaction.processReceipts([tx])

      for (let subscription of this.subscriptions.transaction) {
        subscription.emit('mempool/transaction', tx)
      }
    } catch (err) {
      this._handleError(err)
    }
  }

  async _validate(tx) {
    let prevTxs = await this.#Transaction.findAll({
      where: {id: {[$in]: tx.inputs.map(input => input.prevTxId)}},
      attributes: ['_id', 'id']
    })
    let txos = []
    for (let input of tx.inputs) {
      let item = prevTxs.find(tx => Buffer.compare(tx.id, input.prevTxId) === 0)
      if (!item) {
        return false
      }
      txos.push([item._id, input.outputIndex])
    }
    let [{count}] = await this.#db.query(
      sql`SELECT COUNT(*) AS count FROM transaction_output WHERE (transaction_id, output_index) IN ${txos}`,
      {type: this.#db.QueryTypes.SELECT}
    )
    return Number(count) === tx.inputs.length
  }
}

module.exports = MempoolService
