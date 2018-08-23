import {Address} from 'qtuminfo-lib'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import Service from './base'
import {toBigInt} from '../utils'
import QtumBalanceChanges from '../models/qtum-balance-changes'

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
    let inputOperations = tx.inputs.map((input, index) => ({
      updateOne: {
        filter: {
          'output.transactionId': input.prevTxId,
          'output.index': input.outputIndex
        },
        update: {
          input: {
            height: 0xffffffff,
            transactionId: tx.id,
            index,
            scriptSig: input.scriptSig.toBuffer(),
            sequence: input.sequence
          }
        }
      }
    }))
    await TransactionOutput.bulkWrite(inputOperations)

    let outputTxos = tx.outputs.map((output, index) => {
      let address = Address.fromScript(output.scriptPubKey, this.chain, tx.id, index)
      if (address && address.type === Address.PAY_TO_PUBLIC_KEY) {
        address.type = Address.PAY_TO_PUBLIC_KEY_HASH
      }
      return {
        output: {
          transactionId: tx.id,
          index,
          scriptPubKey: output.scriptPubKey.toBuffer()
        },
        value: output.value,
        ...address ? {address: {type: address.type, hex: address.data}} : {},
        isStake: tx.outputs[0].scriptPubKey.isEmpty()
      }
    })
    await TransactionOutput.insertMany(outputTxos)

    let balanceChanges = await this._transaction.getBalanceChanges(tx.id)
    for (let item of balanceChanges) {
      item.id = tx.id
      item.value = toBigInt(item.value)
    }
    await QtumBalanceChanges.insertMany(balanceChanges, {ordered: false})

    await Transaction.create({
      id: tx.id,
      hash: tx.hash,
      version: tx.version,
      marker: tx.marker,
      flag: tx.flag,
      witnesses: tx.witnesses,
      lockTime: tx.lockTime,
      size: tx.size,
      weight: tx.weight
    })

    this.node.getTransaction(tx.id).then(transaction => {
      for (let subscription of this.subscriptions.transaction) {
        subscription.emit('mempool/transaction', transaction)
      }
    })
  }
}
