import Transaction from '../models/transaction'
import QtumBalance from '../models/qtum-balance'
import QtumSnapshot from '../models/qtum-snapshot'
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
      await this.onReorg(blockTip.height)
      this._tip = {height: blockTip.height, hash: blockTip.hash}
      await this.node.updateServiceTip(this.name, this._tip)
    }
  }

  async onBlock(block) {
    if (block.height === 0) {
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
      {$match: {value: {$ne: 0}}},
      {
        $project: {
          _id: false,
          address: '$_id',
          balance: '$value'
        }
      },
      {$sort: {'address.hex': 1, 'addresss.type': 1}}
    ])
    let originalBalances = await QtumSnapshot.collection.find(
      {address: {$in: balanceChanges.map(item => item.address)}},
      {sort: {'address.hex': 1, 'address.type': 1}}
    ).toArray()
    let mergeResult = mergeBalance(balanceChanges, originalBalances)
    await QtumBalance.collection.bulkWrite(
      mergeResult.map(({address, balance}) => ({
        insertOne: {
          document: {
            height: block.height,
            address,
            balance
          }
        }
      }))
    )
    await QtumSnapshot.collection.bulkWrite(
      mergeResult.map(({address, balance}) => ({
        updateOne: {
          filter: {address},
          update: {$set: {balance}},
          upsert: true
        }
      }))
    )
    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onReorg(height) {
    await QtumBalance.deleteMany({height: {$gt: height}})
    await QtumBalance.aggregate([
      {$sort: {height: -1}},
      {
        $group: {
          _id: '$address',
          balance: {$first: '$balance'}
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          balance: '$balance'
        }
      },
      {$out: 'qtumsnapshots'}
    ]).allowDiskUse(true)
  }
}

function sortAddress({address: x}, {address: y}) {
  if (x.hex < y.hex) {
    return -1
  } else if (x.hex > y.hex) {
    return 1
  } else if (x.type < y.type) {
    return -1
  } else if (x.type > y.type) {
    return 1
  } else {
    return 0
  }
}

function mergeBalance(x, y) {
  let i = 0
  let j = 0
  let result = []
  while (i < x.length && j < y.length) {
    let comparison = sortAddress(x[i], y[j])
    if (comparison < 0) {
      result.push({
        address: x[i].address,
        balance: BigInttoLong(toBigInt(x[i].balance))
      })
      ++i
    } else if (comparison > 0) {
      result.push({
        address: y[j].address,
        balance: BigInttoLong(toBigInt(y[j].balance))
      })
      ++j
    } else {
      result.push({
        address: x[i].address,
        balance: BigInttoLong(toBigInt(x[i].balance) + toBigInt(y[j].balance))
      })
      ++i
      ++j
    }
  }
  while (i < x.length) {
    result.push({
      address: x[i].address,
      balance: BigInttoLong(toBigInt(x[i].balance))
    })
    ++i
  }
  while (j < y.length) {
    result.push({
      address: y[j].address,
      balance: BigInttoLong(toBigInt(y[j].balance))
    })
    ++j
  }
  return result
}
