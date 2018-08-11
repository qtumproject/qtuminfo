import {Address, Script, Input, Output, Transaction as RawTransaction} from 'qtuminfo-lib'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import QtumBalance from '../models/qtum-balance'
import Service from './base'
import {toBigInt, BigInttoLong} from '../utils'

export default class TransactionService extends Service {
  constructor(options) {
    super(options)
    this._tip = null
  }

  static get dependencies() {
    return ['block', 'db']
  }

  get APIMethods() {
    return {getTransaction: this.getTransaction.bind(this)}
  }

  async getTransaction(id) {
    let transaction = (await Transaction.aggregate([
      {$match: {id: id.toString('hex')}},
      {$unwind: '$inputs'},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'inputs',
          foreignField: '_id',
          as: 'input'
        }
      },
      {
        $group: {
          _id: '$_id',
          id: {$first: '$id'},
          hash: {$first: '$hash'},
          version: {$first: '$version'},
          marker: {$first: '$marker'},
          flag: {$first: '$flag'},
          inputs: {
            $push: {
              prevTxId: {$arrayElemAt: ['$input.output.transactionId', 0]},
              outputIndex: {$arrayElemAt: ['$input.output.index', 0]},
              scriptSig: {$arrayElemAt: ['$input.input.scriptSig', 0]},
              sequence: {$arrayElemAt: ['$input.input.sequence', 0]},
              value: {$arrayElemAt: ['$input.value', 0]},
              address: {$arrayElemAt: ['$input.address', 0]}
            }
          },
          outputs: {$first: '$outputs'},
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'},
          block: {$first: '$block'},
          size: {$first: '$size'},
          balanceChanges: {$first: '$balanceChanges'},
          receipts: {$first: '$receipts'}
        }
      },
      {$unwind: '$outputs'},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'outputs',
          foreignField: '_id',
          as: 'output'
        }
      },
      {
        $group: {
          _id: '$_id',
          id: {$first: '$id'},
          hash: {$first: '$hash'},
          version: {$first: '$version'},
          marker: {$first: '$marker'},
          flag: {$first: '$flag'},
          inputs: {$first: '$inputs'},
          outputs: {
            $push: {
              value: {$arrayElemAt: ['$output.value', 0]},
              scriptPubKey: {$arrayElemAt: ['$output.output.scriptPubKey', 0]},
              address: {$arrayElemAt: ['$output.address', 0]}
            }
          },
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'},
          block: {$first: '$block'},
          size: {$first: '$size'},
          balanceChanges: {$first: '$balanceChanges'},
          receipts: {$first: '$receipts'}
        }
      }
    ]))[0]

    return {
      id: Buffer.from(transaction.id, 'hex'),
      hash: Buffer.from(transaction.hash, 'hex'),
      version: transaction.version,
      marker: transaction.marker,
      flag: transaction.flag,
      inputs: transaction.inputs.map(input => {
        let result = new Input({
          prevTxId: 'prevTxId' in input ? Buffer.from(input.prevTxId, 'hex') : Buffer.alloc(32),
          outputIndex: 'outputIndex' in input ? input.outputIndex : 0xffffffff,
          scriptSig: Script.fromBuffer(input.scriptSig.buffer),
          sequence: input.sequence
        })
        result.value = toBigInt(input.value)
        result.address = input.address
          ? new Address({type: input.address.type, data: input.address.hex, chain: this.chain})
          : null
        return result
      }),
      outputs: transaction.outputs.map(output => {
        let result = new Output({
          value: toBigInt(output.value),
          scriptPubKey: Script.fromBuffer(output.scriptPubKey.buffer)
        })
        result.address = output.address
          ? new Address({type: output.address.type, data: output.address.hex, chain: this.chain})
          : null
        return result
      }),
      witnesses: transaction.witnesses.map(witness => witness.map(item => item.buffer)),
      lockTime: transaction.lockTime,
      ...transaction.block
        ? {
          block: {
            hash: Buffer.from(transaction.block.hash, 'hex'),
            height: transaction.block.height,
            timestamp: transaction.block.timestamp
          }
        }
        : {},
      size: transaction.size,
      balanceChanges: transaction.balanceChanges.map(({address, value}) => ({
        address: address
          ? new Address({type: address.type, data: address.hex, chain: this.chain})
          : null,
        value: toBigInt(value)
      })),
      receipts: transaction.receipts
    }
  }

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
      await this.node.updateServiceTip(this.name, this._tip)
    }
    await Transaction.deleteMany({'block.height': {$gt: this._tip.height}})
    await TransactionOutput.bulkWrite([
      {deleteMany: {filter: {'output.height': {$gt: this._tip.height}}}},
      {
        updateMany: {
          filter: {'input.height': {$gt: this._tip.height}},
          update: {$unset: {input: ''}}
        }
      }
    ])
    await QtumBalance.deleteMany({height: {$gt: this._tip.height}})
  }

  async onReorg(height) {
    let outputTransactionIds = (await Transaction.find(
      {
        'block.height': {$gt: height},
        index: {$in: [0, 1]}
      },
      'id'
    )).map(tx => tx.id)
    await Transaction.bulkWrite([
      {deleteMany: {filter: {id: {$in: outputTransactionIds}}}},
      {
        updateMany: {
          filter: {'block.height': {$gt: height}},
          update: {block: {height: 0xffffffff}}
        }
      }
    ])
    await TransactionOutput.bulkWrite([
      {deleteMany: {filter: {'output.transactionId': {$in: outputTransactionIds}}}},
      {
        updateMany: {
          filter: {'output.height': {$gt: height}},
          update: {'output.height': 0xffffffff}
        }
      },
      {
        updateMany: {
          filter: {'input.height': {$gt: height}},
          update: {'input.height': 0xffffffff}
        }
      }
    ])
    await QtumBalance.deleteMany({height: {$gt: height}})
  }

  async onBlock(block) {
    if (this.node.stopping) {
      return
    }
    for (let i = 0; i < block.transactions.length; ++i) {
      await this._processTransaction(block.transactions[i], i, block)
    }
    if (block.height > 0) {
      await this._updateBalances(block.height)
    }
    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async _processTransaction(tx, indexInBlock, block) {
    let resultTransaction = await Transaction.findOne({id: tx.id.toString('hex')})
    if (resultTransaction) {
      await TransactionOutput.bulkWrite([
        {
          updateMany: {
            filter: {'input.transactionId': tx.id.toString('hex')},
            update: {'input.height': block.height}
          }
        },
        {
          updateMany: {
            filter: {'output.transactionId': tx.id.toString('hex')},
            update: {'output.height': block.height}
          }
        }
      ])
      resultTransaction.block = {
        hash: block.hash,
        height: block.height,
        timestamp: block.header.timestamp
      }
      resultTransaction.index = indexInBlock
      await resultTransaction.save()
      return
    }

    let balanceChanges = []

    let inputs = await Promise.all(
      tx.inputs.map(async (input, index) => {
        let txo
        if (Buffer.compare(input.prevTxId, Buffer.alloc(32)) === 0 && input.outputIndex === 0xffffffff) {
          txo = await TransactionOutput.create({
            input: {
              height: block.height,
              transactionId: tx.id,
              index,
              scriptSig: input.scriptSig.toBuffer(),
              sequence: input.sequence
            }
          })
        } else {
          txo = await TransactionOutput.findOne({
            'output.transactionId': input.prevTxId.toString('hex'),
            'output.index': input.outputIndex
          })
          let invalidTxId = txo.input && txo.input.transactionId.toString('hex')
          txo.input = {
            height: block.height,
            transactionId: tx.id,
            index,
            scriptSig: input.scriptSig.toBuffer(),
            sequence: input.sequence
          }
          await txo.save()
          if (invalidTxId) {
            await Transaction.deleteOne({id: invalidTxId})
            await TransactionOutput.bulkWrite([
              {deleteMany: {filter: {'output.transactionId': invalidTxId}}},
              {
                updateMany: {
                  filter: {'input.transactionId': invalidTxId},
                  update: {$unset: {input: ''}}
                }
              }
            ])
          }
        }
        if (txo.value) {
          balanceChanges.push({address: txo.address, value: -txo.value})
        }
        return txo._id
      })
    )

    let outputs = await Promise.all(
      tx.outputs.map(async (output, index) => {
        let address = Address.fromScript(output.scriptPubKey, this.chain, tx.id, index)
        if (address && address.type === Address.PAY_TO_PUBLIC_KEY) {
          address.type = Address.PAY_TO_PUBLIC_KEY_HASH
        }
        let txo = await TransactionOutput.create({
          output: {
            height: block.height,
            transactionId: tx.id,
            index,
            scriptPubKey: output.scriptPubKey.toBuffer()
          },
          value: output.value,
          ...address ? {address: {type: address.type, hex: address.data}} : {},
          isStake: tx.outputs[0].scriptPubKey.isEmpty()
        })
        if (txo.value) {
          balanceChanges.push({address: txo.address, value: txo.value})
        }
        return txo._id
      })
    )

    let balanceMapping = {}
    for (let {address, value} of balanceChanges) {
      if (address) {
        let addressKey = `${address.type}:${address.hex.toString('hex')}`
        balanceMapping[addressKey] = addressKey in balanceMapping ? balanceMapping[addressKey] + value : value
      } else {
        balanceMapping[''] = '' in balanceMapping ? balanceMapping[''] + value : value
      }
    }
    balanceChanges = []
    for (let [addressKey, value] of Object.entries(balanceMapping)) {
      let address = null
      if (addressKey) {
        let [type, data] = addressKey.split(':')
        address = {type, hex: Buffer.from(data, 'hex')}
      }
      balanceChanges.push({...address ? {address} : {}, value})
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
      inputs,
      outputs,
      witnesses: tx.witnesses,
      lockTime: tx.lockTime,
      block: {
        hash: block.hash,
        height: block.height,
        timestamp: block.header.timestamp
      },
      index: indexInBlock,
      size: tx.size,
      weight: tx.weight,
      balanceChanges: block.height === 0 ? [] : balanceChanges,
      createIndex: latestItem ? latestItem.createIndex + 1 : 0
    })
  }

  async _updateBalances(height) {
    let balances = await Transaction.aggregate([
      {$match: {'block.height': height}},
      {$unwind: '$balanceChanges'},
      {$match: {'balanceChanges.address': {$ne: null}}},
      {
        $group: {
          _id: '$balanceChanges.address',
          value: {$sum: '$balanceChanges.value'}
        }
      },
      {$match: {value: {$ne: 0}}},
      {
        $project: {
          _id: false,
          address: '$_id',
          value: '$value'
        }
      },
      {
        $lookup: {
          from: 'qtumbalances',
          localField: 'address',
          foreignField: 'address',
          as: 'originals'
        }
      },
      {
        $project: {
          address: '$address',
          value: '$value',
          originals: {
            $concatArrays: [
              '$originals',
              [{height: 0, balance: 0}]
            ]
          }
        }
      },
      {$unwind: '$originals'},
      {$sort: {'originals.height': -1}},
      {
        $group: {
          _id: '$address',
          value: {$first: '$value'},
          balance: {$first: '$originals.balance'}
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          balance: {$add: ['$balance', '$value']}
        }
      }
    ])
    for (let item of balances) {
      item.height = height
      item.balance = BigInttoLong(toBigInt(item.balance))
    }
    await QtumBalance.collection.insertMany(balances)
  }
}
