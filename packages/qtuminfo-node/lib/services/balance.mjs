import {Address} from 'qtuminfo-lib'
import TransactionOutput from '../models/transaction-output'
import QtumBalanceChanges from '../models/qtum-balance-changes'
import AddressInfo from '../models/address-info'
import Service from './base'
import {toBigInt, BigInttoLong} from '../utils'

export default class BalanceService extends Service {
  constructor(options) {
    super(options)
    this._tip = null
    this._processing = false
  }

  static get dependencies() {
    return ['block', 'db', 'transaction']
  }

  get APIMethods() {
    return {
      getBalanceRanking: this.getBalanceRanking.bind(this),
      getRichList: this.getRichList.bind(this)
    }
  }

  async getBalanceRanking(address) {
    if (address.type === Address.PAY_TO_PUBLIC_KEY) {
      address = {
        type: Address.PAY_TO_PUBLIC_KEY_HASH,
        hex: address.data.toString('hex')
      }
    } else if ([Address.CONTRACT_CREATE, Address.CONTRACT_CALL].includes(address.type)) {
      address = {
        type: Address.CONTRACT,
        hex: address.data.toString('hex')
      }
    } else {
      address = {
        type: address.type,
        hex: address.data.toString('hex')
      }
    }
    let balance = await AddressInfo.findOne({address}, '-_id balance', {lean: true})
    if (balance) {
      return await AddressInfo.countDocuments({balance: {$gt: balance.balance}}) + 1
    } else {
      return await AddressInfo.countDocuments({balance: {$ne: 0}}) + 1
    }
  }

  async getRichList({height = null, pageIndex = 0, pageSize = 100} = {}) {
    if (height === null || height === this._tip.height) {
      await this._waitUntilProcessed()
      let result = await AddressInfo.find(
        {balance: {$ne: 0}},
        '-_id address balance',
        {
          sort: {balance: -1},
          limit: pageSize,
          skip: pageIndex * pageSize
        }
      )
      let count = await AddressInfo.countDocuments({balance: {$ne: 0}})
      return {
        totalCount: count,
        list: result.map(({address, balance}) => ({
          address: new Address({
            type: address.type,
            data: Buffer.from(address.hex, 'hex'),
            chain: this.chain
          }),
          balance
        }))
      }
    } else {
      let [{count, list}] = await TransactionOutput.aggregate([
        {
          $match: {
            $and: [
              {address: {$ne: null}},
              {'address.type': {$ne: Address.CONTRACT}}
            ],
            value: {$ne: 0},
            'output.height': {$gt: 0, $lte: height},
            $or: [
              {input: null},
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
        },
        {
          $facet: {
            count: [{$count: 'count'}],
            list: [
              {$sort: {balance: -1}},
              {$skip: pageSize},
              {$limit: pageIndex * pageSize}
            ]
          }
        }
      ]).allowDiskUse(true)
      return {
        totalCount: count.length && count[0].count,
        list: list.map(({address, balance}) => ({
          address: new Address({
            type: address.type,
            data: Buffer.from(address.hex, 'hex'),
            chain: this.chain
          }),
          balance
        }))
      }
    }
  }

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
      await this._rebuildBalances()
      await this.node.updateServiceTip(this.name, this._tip)
    }
  }

  async stop() {
    await this._waitUntilProcessed()
  }

  async onBlock(block) {
    await this._waitUntilProcessed()
    this._processing = true
    if (block.height === 0) {
      let contracts = [0x80, 0x81, 0x82, 0x83, 0x84].map(
        x => Buffer.concat([Buffer.alloc(19), Buffer.from([x])])
      )
      await AddressInfo.insertMany(
        contracts.map(address => ({
          address: {type: Address.CONTRACT, hex: address},
          string: address.toString('hex'),
          balance: 0n,
          createHeight: 0
        })),
        {ordered: false}
      )
      this._processing = false
      return
    }

    let balanceChanges = await QtumBalanceChanges.aggregate([
      {
        $match: {
          'block.height': block.height,
          address: {$ne: null}
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
    ]).allowDiskUse(true)
    let result = await AddressInfo.collection.bulkWrite(
      balanceChanges.map(({address, value}) => ({
        updateOne: {
          filter: {address},
          update: {$inc: {balance: BigInttoLong(toBigInt(value))}},
          upsert: true
        }
      })),
      {ordered: false}
    )
    let newAddressOperations = []
    for (let index of Object.keys(result.upsertedIds)) {
      let {address} = balanceChanges[index]
      if (address) {
        continue
      }
      let addressString = new Address({
        type: address.type,
        data: Buffer.from(address.hex, 'hex'),
        chain: this.chain
      }).toString()
      newAddressOperations.push({
        updateOne: {
          filter: {address},
          update: {
            $set: {
              string: addressString,
              createHeight: block.height
            }
          }
        }
      })
    }
    if (newAddressOperations.length) {
      await AddressInfo.collection.bulkWrite(newAddressOperations, {ordered: false})
    }

    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
    this._processing = false
  }

  async onReorg(height, hash) {
    await this._waitUntilProcessed()
    this._processing = true
    let balanceChanges = await QtumBalanceChanges.aggregate([
      {
        $match: {
          'block.height': {$gt: height},
          address: {$ne: null}
        }
      },
      {
        $group: {
          _id: '$address',
          value: {$sum: {$subtract: [0, '$value']}}
        }
      },
      {$match: {value: {$ne: 0}}}
    ]).allowDiskUse(true)
    await AddressInfo.collection.bulkWrite([
      {deleteMany: {filter: {createHeight: {$gt: height}}}},
      ...balanceChanges.map(({address, value}) => ({
        updateOne: {
          filter: {address},
          update: {$inc: {balance: value}}
        }
      }))
    ])
    this._tip.height = height
    this._tip.hash = hash
    await this.node.updateServiceTip(this.name, this._tip)
    this._processing = false
  }

  async _waitUntilProcessed() {
    if (this._processing) {
      await new Promise(resolve => {
        let interval = setInterval(() => {
          if (!this._processing) {
            clearInterval(interval)
            resolve()
          }
        }, 0)
      })
    }
  }

  async _rebuildBalances() {
    this._processing = true
    let balances = await TransactionOutput.aggregate([
      {
        $match: {
          address: {$ne: null},
          value: {$ne: 0},
          'output.height': {$gt: 0, $lte: this._tip.height},
          $or: [
            {input: null},
            {'input.height': {$gt: this._tip.height}}
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
    await AddressInfo.bulkWrite([
      {deleteMany: {filter: {height: {$gt: this._tip.height}}}},
      {
        updateMany: {
          filter: {},
          update: {balance: 0n}
        }
      },
      ...balances.map(({address, balance}) => ({
        updateOne: {
          filter: {address},
          update: {$set: {balance}}
        }
      }))
    ])
    this._processing = false
  }
}
