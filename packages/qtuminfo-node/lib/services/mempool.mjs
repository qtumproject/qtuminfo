import {Address} from 'qtuminfo-lib'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import Service from './base'
import {toBigInt} from '../utils'

export default class MempoolService extends Service {
  constructor(options) {
    super(options)
    this.subscriptions = {transaction: []}
    this._enabled = false
  }

  static get dependencies() {
    return ['db', 'p2p']
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

    let balanceChanges = await TransactionOutput.aggregate([
      {
        $match: {
          value: {$ne: 0},
          $or: [
            {'input.transactionId': tx.id.toString('hex')},
            {'output.transactionId': tx.id.toString('hex')},
          ]
        }
      },
      {
        $project: {
          address: '$address',
          value: {
            $cond: {
              if: {$eq: ['$input.transactionId', tx.id.toString('hex')]},
              then: {$subtract: [0, '$value']},
              else: '$value'
            }
          }
        }
      },
      {
        $group: {
          _id: '$address',
          value: {$sum: '$value'}
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          value: '$value'
        }
      }
    ])
    for (let item of balanceChanges) {
      item.value = toBigInt(item.value)
    }

    let latestItem = await Transaction.findOne(
      {},
      'createIndex',
      {sort: {createIndex: -1}, limit: 1}
    )
    await Transaction.create({
      id: tx.id,
      hash: tx.hash,
      version: tx.version,
      marker: tx.marker,
      flag: tx.flag,
      witnesses: tx.witnesses,
      lockTime: tx.lockTime,
      size: tx.size,
      weight: tx.weight,
      balanceChanges,
      createIndex: latestItem ? latestItem.createIndex + 1 : 0
    })
    // TODO subscriptions
  }
}
