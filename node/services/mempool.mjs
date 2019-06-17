import Service from './base'

export default class MempoolService extends Service {
  subscriptions = {transaction: []}
  #transaction = null
  #subscribed = false
  #enabled = false
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
  }

  _startSubscriptions() {
    if (this.#subscribed) {
      return
    }
    this.#subscribed = true
    if (!this.#bus) {
      this.#bus = this.node.openBus({remoteAddress: 'localhost-mempool'})
    }
    this.#bus.on('p2p/transaction', this._onTransaction.bind(this))
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

  async _onTransaction(tx) {
    try {
      if (!await this._validate(tx)) {
        return
      }
      await this.#transaction.removeReplacedTransactions(tx)
      let witnesses = []
      await this.#Transaction.create({
        id: tx.id,
        hash: tx.hash,
        version: tx.version,
        flag: tx.flag,
        lockTime: tx.lockTime,
        blockHeight: 0xffffffff,
        indexInBlock: 0xffffffff,
        size: tx.size,
        weight: tx.weight
      })
      for (let i = 0; i < tx.witnesses.length; ++i) {
        for (let j = 0; j < tx.witnesses[i].length; ++j) {
          witnesses.push({
            transactionId: tx.id,
            inputIndex: i,
            witnessIndex: j,
            script: tx.witnesses[i][j]
          })
        }
      }
      await Promise.all([
        this.#Witness.bulkCreate(witnesses, {validate: false}),
        this.#transaction.processOutputs([tx], {height: 0xffffffff}),
        this.#transaction.processInputs([tx], {height: 0xffffffff})
      ])
      await this.#transaction.processBalanceChanges({height: 0xffffffff}, [tx])

      for (let subscription of this.subscriptions.transaction) {
        subscription.emit('mempool/transaction', tx)
      }
    } catch (err) {
      this.logger.error('Mempool Service:', err)
      this.node.stop()
    }
  }

  async _validate(tx) {
    let txos = tx.inputs.map(input => `(0x${input.prevTxId.toString('hex')}, ${input.outputIndex})`).join(', ')
    let [{count}] = await this.#db.query(
      `SELECT COUNT(*) AS count FROM transaction_output WHERE (output_transaction_id, output_index) IN (${txos})`,
      {type: this.#db.QueryTypes.SELECT}
    )
    return Number(count) === tx.inputs.length
  }
}
