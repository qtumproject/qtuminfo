import {Address, Script, Input, Output} from 'qtuminfo-lib'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import Service from './base'
import {toBigInt} from '../utils'

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
    let [transaction] = await Transaction.aggregate([
      {$match: {id: id.toString('hex')}},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'id',
          foreignField: 'input.transactionId',
          as: 'input'
        }
      },
      {$unwind: '$input'},
      {$sort: {'input.index': 1}},
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
              prevTxId: '$input.output.transactionId',
              outputIndex: '$input.output.index',
              scriptSig: '$input.input.scriptSig',
              sequence: '$input.input.sequence',
              value: '$input.value',
              address: '$input.address'
            }
          },
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'},
          block: {$first: '$block'},
          size: {$first: '$size'},
          balanceChanges: {$first: '$balanceChanges'},
          receipts: {$first: '$receipts'}
        }
      },
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'id',
          foreignField: 'output.transactionId',
          as: 'output'
        }
      },
      {$unwind: '$output'},
      {$sort: {'output.index': 1}},
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
              value: '$output.value',
              scriptPubKey: '$output.output.scriptPubKey',
              address: '$output.address'
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
    ])

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
  }

  async onBlock(block) {
    if (this.node.stopping) {
      return
    }
    for (let i = 0; i < block.transactions.length; ++i) {
      await this._processTransaction(block.transactions[i], i, block)
    }
    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async _processTransaction(tx, indexInBlock, block) {
    let resultTransaction = await Transaction.findOne({id: tx.id})
    if (resultTransaction) {
      await TransactionOutput.bulkWrite([
        {
          updateMany: {
            filter: {'input.transactionId': tx.id},
            update: {'input.height': block.height}
          }
        },
        {
          updateMany: {
            filter: {'output.transactionId': tx.id},
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

    let inputOperations = tx.inputs.map((input, index) => {
      if (Buffer.compare(input.prevTxId, Buffer.alloc(32)) === 0 && input.outputIndex === 0xffffffff) {
        return {
          insertOne: {
            document: {
              input: {
                height: block.height,
                transactionId: tx.id,
                index,
                scriptSig: input.scriptSig.toBuffer(),
                sequence: input.sequence
              }
            }
          }
        }
      } else {
        return {
          updateOne: {
            filter: {
              'output.transactionId': input.prevTxId,
              'output.index': input.outputIndex
            },
            update: {
              input: {
                height: block.height,
                transactionId: tx.id,
                index,
                scriptSig: input.scriptSig.toBuffer(),
                sequence: input.sequence
              }
            }
          }
        }
      }
    })
    await TransactionOutput.bulkWrite(inputOperations, {ordered: false})

    let outputTxos = tx.outputs.map((output, index) => {
      let address = Address.fromScript(output.scriptPubKey, this.chain, tx.id, index)
      if (address) {
        if (address.type === Address.PAY_TO_PUBLIC_KEY) {
          address.type = Address.PAY_TO_PUBLIC_KEY_HASH
        } else if ([Address.CONTRACT_CREATE, Address.CONTRACT_CALL].includes(address.type)) {
          address.type = 'contract'
        }
      }
      return {
        output: {
          height: block.height,
          transactionId: tx.id,
          index,
          scriptPubKey: output.scriptPubKey.toBuffer()
        },
        value: output.value,
        ...address ? {address: {type: address.type, hex: address.data}} : {},
        isStake: tx.outputs[0].scriptPubKey.isEmpty()
      }
    })
    await TransactionOutput.insertMany(outputTxos, {ordered: false})

    let balanceChanges = await TransactionOutput.aggregate([
      {
        $match: {
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
}
