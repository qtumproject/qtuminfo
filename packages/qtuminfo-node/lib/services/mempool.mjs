import Service from './base'

export default class MempoolService extends Service {
  constructor(options) {
    super(options)
    this.subscriptions = {transaction: []}
    this._transaction = this.node.services.get('transaction')
    this._enabled = false
  }

  static get dependencies() {
    return ['db', 'p2p', 'transaction']
  }

  async start() {
    this.db = this.node.getDatabase()
    this.Transaction = this.node.getModel('transaction')
    this.Witness = this.node.getModel('witness')
  }

  _startSubscriptions() {
    if (this._subscribed) {
      return
    }
    this._subscribed = true
    if (!this._bus) {
      this._bus = this.node.openBus({remoteAddress: 'localhost-mempool'})
    }
    this._bus.on('p2p/transaction', this._onTransaction.bind(this))
    this._bus.subscribe('p2p/transaction')
  }

  enable() {
    this.logger.info('Mempool Service: mempool enabled')
    this._startSubscriptions()
    this._enabled = true
  }

  onSynced() {
    this.enable()
  }

  async _onTransaction(tx) {
    if (!await this._validate(tx)) {
      return
    }
    await this._transaction.removeReplacedTransactions(tx)
    let witnesses = []
    await this.Transaction.create({
      id: tx.id,
      hash: tx.hash,
      version: tx.version,
      marker: tx.marker || 0,
      flag: Boolean(tx.flag),
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
      this.Witness.bulkCreate(witnesses, {validate: false}),
      this._transaction.processOutputs([tx], {height: 0xffffffff}),
      this._transaction.processInputs([tx], {height: 0xffffffff})
    ])
    await this._transaction.processBalanceChanges({transactions: [tx]})

    for (let subscription of this.subscriptions.transaction) {
      subscription.emit('mempool/transaction', tx)
    }
  }

  async _validate(tx) {
    let txos = tx.inputs.map(input => `(0x${input.prevTxId.toString('hex')}, ${input.outputIndex})`).join(', ')
    let [{count}] = await this.db.query(
      `SELECT COUNT(*) AS count FROM transaction_output WHERE (output_transaction_id, output_index) IN (${txos})`,
      {type: this.db.QueryTypes.SELECT}
    )
    return Number(count) === tx.inputs.length
  }
}
