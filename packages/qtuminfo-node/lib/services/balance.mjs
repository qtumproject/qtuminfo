import {Address} from 'qtuminfo-lib'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import AddressInfo from '../models/address-info'
import QtumBalance from '../models/qtum-balance'
import Service from './base'
import {toBigInt, BigInttoLong} from '../utils'

export default class BalanceService extends Service {
  constructor(options) {
    super(options)
    this._tip = null
  }

  static get dependencies() {
    return ['block', 'db', 'transaction']
  }

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
      await this.node.updateServiceTip(this.name, this._tip)
    }
    let maxHeight = await QtumBalance.findOne(
      {},
      'height',
      {sort: {height: -1}, limit: 1, lean: true}
    )
    if (maxHeight && maxHeight.height > this._tip.height) {
      this.onReorg(this._tip.height)
    }
    await AddressInfo.deleteMany({createHeight: {$gt: this._tip.height}})
  }

  async onBlock(block) {
    if (block.height === 0) {
      let contracts = [0x80, 0x81, 0x82, 0x83, 0x84].map(x => Buffer.concat([Buffer.alloc(19), Buffer.from([x])]))
      await QtumBalance.insertMany(
        contracts.map(address => ({
          height: 0,
          address: {type: 'contract', hex: address},
          balance: 0n
        })),
        {ordered: false}
      )
      await AddressInfo.insertMany(
        contracts.map(address => ({
          address: {type: 'contract', hex: address},
          string: address.toString('hex'),
          balance: 0n,
          createHeight: 0
        })),
        {ordered: false}
      )
      return
    }

    let balanceChanges = await Transaction.aggregate([
      {$match: {'block.height': block.height}},
      {$unwind: '$balanceChanges'},
      {$match: {'balanceChanges.address': {$ne: null}}},
      {
        $group: {
          _id: '$balanceChanges.address',
          value: {$sum: '$balanceChanges.value'}
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          balance: '$value'
        }
      },
      {$sort: {'address.hex': 1, 'addresss.type': 1}}
    ])
    let originalBalances = await AddressInfo.collection.find(
      {address: {$in: balanceChanges.map(item => item.address)}},
      {sort: {'address.hex': 1, 'address.type': 1}}
    ).toArray()
    let mergeResult = []
    for (let i = 0, j = 0; i < balanceChanges.length; ++i) {
      if (
        j >= originalBalances.length
        || balanceChanges[i].address.type !== originalBalances[j].address.type
        || balanceChanges[i].address.hex !== originalBalances[j].address.hex
      ) {
        mergeResult.push({
          address: balanceChanges[i].address,
          balance: BigInttoLong(toBigInt(balanceChanges[i].balance)),
        })
      } else {
        if (toBigInt(balanceChanges[i].balance)) {
          mergeResult.push({
            address: balanceChanges[i].address,
            balance: BigInttoLong(toBigInt(originalBalances[j].balance) + toBigInt(balanceChanges[i].balance))
          })
        }
        ++j
      }
    }

    await QtumBalance.collection.bulkWrite(
      mergeResult.map(({address, balance}) => ({
        insertOne: {
          document: {
            height: block.height,
            address,
            balance
          }
        }
      })),
      {ordered: false}
    )
    let result = await AddressInfo.collection.bulkWrite(
      mergeResult.map(({address, balance}) => ({
        updateOne: {
          filter: {address},
          update: {$set: {balance}},
          upsert: true
        }
      })),
      {ordered: false}
    )
    let newAddressOperations = Object.keys(result.upsertedIds).map(index => {
      let {address} = mergeResult[index]
      let addressString = new Address({
        type: address.type,
        data: Buffer.from(address.hex, 'hex'),
        chain: this.chain
      }).toString()
      return {
        updateOne: {
          filter: {address},
          update: {
            $set: {
              string: addressString,
              createHeight: block.height
            }
          }
        }
      }
    })
    if (newAddressOperations.length) {
      await AddressInfo.collection.bulkWrite(newAddressOperations, {ordered: false})
    }

    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onReorg(height) {
    await QtumBalance.deleteMany({height: {$gt: height}})
    await AddressInfo.bulkWrite([
      {deleteMany: {filter: {height: {$gt: height}}}},
      {
        updateMany: {
          filter: {},
          update: {balance: 0n}
        }
      }
    ])
    let balances = await TransactionOutput.aggregate([
      {
        $match: {
          address: {$ne: null},
          value: {$ne: 0},
          'output.height': {$gt: 0, $lte: height},
          $or: [
            {$input: null},
            {'input.height': {$gt: height}}
          ]
        }
      },
      {
        $group: {
          _id: '$address',
          balance: {$sum: '$value'}
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          balance: '$balance'
        }
      }
    ])
    await AddressInfo.bulkWrite(
      balances.map(({address, balance}) => ({
        updateOne: {
          filter: {address},
          update: {$set: {balance}}
        }
      })),
      {ordered: false}
    )
  }
}
