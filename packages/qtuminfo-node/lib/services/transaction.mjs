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
          prevTxId: Buffer.from(input.prevTxId, 'hex'),
          outputIndex: input.outputIndex,
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
      this._tip = blockTip
      await this.node.updateServiceTip(this.name, this._tip)
    }
    await Transaction.deleteMany({'block.height': {$gt: blockTip.height}})
    await TransactionOutput.bulkWrite([
      {deleteMany: {filter: {'output.height': {$gt: blockTip.height}}}},
      {
        updateMany: {
          filter: {'input.height': {$gt: blockTip.height}},
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
    let balanceChanges = []
    let inputs = []
    let outputs = []

    for (let index = 0; index < tx.inputs.length; ++index) {
      let input = tx.inputs[index]
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
        txo = await TransactionOutput.findOneAndUpdate(
          {
            'output.transactionId': input.prevTxId.toString('hex'),
            'output.index': input.outputIndex
          },
          {
            input: {
              height: block.height,
              transactionId: tx.id,
              index,
              scriptSig: input.scriptSig.toBuffer(),
              sequence: input.sequence
            }
          },
          {
            new: true,
            upsert: true,
            fields: 'address value'
          }
        )
      }
      inputs.push(txo._id)
      if (txo.value) {
        balanceChanges.push({
          ...txo.address
            ? {
              address: {
                type: txo.address.type,
                hex: txo.address.data
              }
            }
            : {},
          value: -txo.value
        })
      }
    }

    for (let index = 0; index < tx.outputs.length; ++index) {
      let output = tx.outputs[index]
      let txo = await TransactionOutput.findOne({
        'output.transactionId': tx.id.toString('hex'),
        'output.index': index
      })
      if (txo) {
        txo.output.height = block.height
        await txo.save()
      } else {
        let address = Address.fromScript(output.scriptPubKey, this.chain, tx.id, index)
        txo = await TransactionOutput.create({
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
      }
      outputs.push(txo._id)
      if (txo.value) {
        balanceChanges.push({
          ...txo.address
            ? {
              address: {
                type: txo.address.type,
                hex: txo.address.data
              }
            }
            : {},
          value: txo.value
        })
      }
    }

    let txBlock = {
      hash: block.hash,
      height: block.height,
      timestamp: block.header.timestamp
    }
    let transaction = await Transaction.findOne({id: tx.id.toString('hex')})
    if (transaction) {
      transaction.block = txBlock
      transaction.index = indexInBlock
      await transaction.save()
    } else {
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
        block: txBlock,
        index: indexInBlock,
        size: tx.size,
        weight: tx.weight,
        balanceChanges,
        createIndex: latestItem ? latestItem.createIndex + 1 : 0
      })
    }
  }
}
