import {Address, Script, Solidity} from 'qtuminfo-lib'
import Block from '../models/block'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import QtumBalanceChanges from '../models/qtum-balance-changes'
import Service from './base'
import {toBigInt} from '../utils'

const TransferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'Transfer')

export default class AddressService extends Service {
  static get dependencies() {
    return ['block', 'db', 'transaction']
  }

  get APIMethods() {
    return {
      getAddressHistory: this.getAddressHistory.bind(this),
      getAddressBalanceHistory: this.getAddressBalanceHistory.bind(this),
      getAddressSummary: this.getAddressSummary.bind(this),
      getBalance: this.getBalance.bind(this),
      getMatureBalance: this.getMatureBalance.bind(this),
      getAddressUnspentOutputs: this.getAddressUnspentOutputs.bind(this),
      getBiggestMiners: this.getBiggestMiners.bind(this)
    }
  }

  // async start() {
  //   console.time('QYHV93kbN9osowPHTWHjeYzgrmZasdatov')
  //   console.log(await this.getAddressSummary(new Address({
  //     type: 'pubkeyhash',
  //     data: Buffer.from('8021d6dbb2d121a33f6b180daf398c2c08cb9848', 'hex'),
  //     chain: this.chain
  //   })))
  //   console.timeEnd('QYHV93kbN9osowPHTWHjeYzgrmZasdatov')
  //   console.time('QZDJya5Szfux2op7qhHUGKsBT4eGiyTPkH')
  //   console.log(await this.getAddressSummary(new Address({
  //     type: 'pubkeyhash',
  //     data: Buffer.from('8a4fd1372b1dd683fede7d68f2332fae2e9c9f71', 'hex'),
  //     chain: this.chain
  //   })))
  //   console.timeEnd('QZDJya5Szfux2op7qhHUGKsBT4eGiyTPkH')
  // }

  async getAddressHistory(addresses, {from = 0, limit = 100, reversed = true} = {}) {
    addresses = parseAddresses(addresses)
    let hexAddresses = toHexAddresses(addresses)
    let sort = reversed ? {'block.height': -1, index: -1} : {'block.height': 1, index: 1}
    let [{count, list}] = await Transaction.aggregate([
      {
        $match: {
          $or: [
            {relatedAddresses: {$in: addresses}},
            {
              'receipts.logs': {
                $elemMatch: {
                  $and: [
                    {topics: TransferABI.id.toString('hex')},
                    {topics: {$in: hexAddresses}},
                    {'topics.0': TransferABI.id.toString('hex')},
                    {
                      $or: [
                        {'topics.1': {$in: hexAddresses}},
                        {'topics.2': {$in: hexAddresses}}
                      ]
                    }
                  ]
                }
              }
            }
          ]
        }
      },
      {
        $facet: {
          count: [{$count: 'count'}],
          list: [
            {$sort: sort},
            {$skip: from},
            {$limit: limit},
            {$project: {_id: false, id: true}}
          ]
        }
      }
    ])
    return {
      totalCount: count.length && count[0].count,
      transactions: list.map(tx => Buffer.from(tx.id, 'hex'))
    }
  }

  async _getAddressTransactionCount(addresses) {
    let hexAddresses = toHexAddresses(addresses)
    return await Transaction.countDocuments({
      $or: [
        {relatedAddresses: {$in: addresses}},
        {
          'receipts.logs': {
            $elemMatch: {
              $and: [
                {topics: TransferABI.id.toString('hex')},
                {topics: {$in: hexAddresses}},
                {'topics.0': TransferABI.id.toString('hex')},
                {
                  $or: [
                    {'topics.1': {$in: hexAddresses}},
                    {'topics.2': {$in: hexAddresses}}
                  ]
                }
              ]
            }
          }
        }
      ]
    })
  }

  async getAddressBalanceHistory(
    addresses,
    {from = 0, limit = 100, reversed = true} = {}
  ) {
    addresses = parseAddresses(addresses)
    let sort = reversed ? {'block.height': -1, index: -1} : {'block.height': 1, index: 1}
    let count = await QtumBalanceChanges.countDocuments({address: {$in: addresses}})
    let list = await QtumBalanceChanges.aggregate([
      {$match: {address: {$in: addresses}}},
      {$sort: sort},
      {$skip: from},
      {$limit: limit},
      {
        $group: {
          _id: '$id',
          block: {$first: '$block'},
          amount: {$sum: '$value'}
        }
      },
      {
        $project: {
          _id: false,
          id: '$_id',
          block: '$block',
          amount: '$amount'
        }
      }
    ])
    return {
      totalCount: count,
      transactions: list.map(({id, block, amount}) => ({
        id: Buffer.from(id, 'hex'),
        block: {
          height: block.height,
          hash: Buffer.from(block.hash, 'hex'),
          timestamp: block.timestamp
        },
        amount: toBigInt(amount)
      }))
    }
  }

  async getAddressSummary(addresses) {
    addresses = parseAddresses(addresses)
    let [balanceChangesResult] = await QtumBalanceChanges.aggregate([
      {$match: {address: {$in: addresses}}},
      {
        $group: {
          _id: null,
          totalReceived: {
            $sum: {
              $cond: {
                if: {$gt: ['$value', 0]},
                then: '$value',
                else: 0
              }
            }
          },
          totalSent: {
            $sum: {
              $cond: {
                if: {$lt: ['$value', 0]},
                then: {$abs: '$value'},
                else: 0
              }
            }
          }
        }
      }
    ])
    if (!balanceChangesResult) {
      return {
        balance: 0n,
        totalReceived: 0n,
        totalSent: 0n,
        unconfirmed: 0n,
        staking: 0n,
        mature: 0n,
        blocksStaked: 0,
        totalCount: 0
      }
    }

    let totalReceived = toBigInt(balanceChangesResult.totalReceived)
    let totalSent = toBigInt(balanceChangesResult.totalSent)
    let [unconfirmed, staking, mature, blocksStaked, totalCount] = await Promise.all([
      this._getUnconfirmedBalance(addresses),
      this._getStakingBalance(addresses),
      this.getMatureBalance(addresses),
      Block.countDocuments({
        height: {$gt: 5000},
        miner: {$in: addresses.filter(address => address.type === Address.PAY_TO_PUBLIC_KEY_HASH)}
      }),
      this._getAddressTransactionCount(addresses)
    ])
    return {
      balance: totalReceived - totalSent,
      totalReceived,
      totalSent,
      unconfirmed,
      staking,
      mature,
      blocksStaked,
      totalCount
    }
  }

  async getBalance(addresses) {
    addresses = parseAddresses(addresses)
    let [result] = await TransactionOutput.aggregate([
      {
        $match: {
          'output.height': {$ne: 0},
          input: null,
          address: {$in: addresses}
        }
      },
      {
        $group: {
          _id: null,
          amount: {$sum: '$value'}
        }
      }
    ])
    return result ? toBigInt(result.amount) : 0n
  }

  async _getUnconfirmedBalance(addresses) {
    let [result] = await TransactionOutput.aggregate([
      {
        $match: {
          'output.height': 0xffffffff,
          input: null,
          address: {$in: addresses}
        }
      },
      {
        $group: {
          _id: null,
          amount: {$sum: '$value'}
        }
      }
    ])
    return result ? toBigInt(result.amount) : 0n
  }

  async _getStakingBalance(addresses) {
    let [result] = await TransactionOutput.aggregate([
      {
        $match: {
          'output.height': {$gt: this.node.getBlockTip().height - 500},
          isStake: true,
          address: {$in: addresses}
        }
      },
      {
        $group: {
          _id: null,
          amount: {$sum: '$value'}
        }
      }
    ])
    return result ? toBigInt(result.amount) : 0n
  }

  async getMatureBalance(addresses) {
    addresses = parseAddresses(addresses).filter(address => address.type === Address.PAY_TO_PUBLIC_KEY_HASH)
    let [result] = await TransactionOutput.aggregate([
      {
        $match: {
          'output.height': {$gt: 0, $lte: this.node.getBlockTip().height - 500},
          input: null,
          address: {$in: addresses}
        }
      },
      {
        $group: {
          _id: null,
          amount: {$sum: '$value'}
        }
      }
    ])
    return result ? toBigInt(result.amount) : 0n
  }

  async getAddressUnspentOutputs(addresses) {
    addresses = parseAddresses(addresses)
    let utxoList = await TransactionOutput.find({
      address: {$in: addresses},
      'output.height': {$ne: 0},
      input: null
    })
    return utxoList.map(utxo => ({
      txid: utxo.output.transactionId,
      vout: utxo.output.index,
      scriptPubKey: utxo.output.scriptPubKey,
      address: Address.fromScript(Script.fromBuffer(utxo.output.scriptPubKey)),
      value: utxo.value,
      isStake: utxo.isStake,
      height: utxo.output.height,
      confirmations: Math.max(this.node.getBlockTip().height - utxo.output.height + 1, 0)
    }))
  }

  async getBiggestMiners({from = 0, limit = 100} = {}) {
    let [{count, list}] = await Block.aggregate([
      {$match: {height: {$gt: 5000}}},
      {
        $group: {
          _id: '$miner',
          blocks: {$sum: 1}
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          blocks: '$blocks'
        }
      },
      {
        $facet: {
          count: [{$count: 'count'}],
          list: [
            {$sort: {blocks: -1}},
            {$skip: from},
            {$limit: limit},
            {
              $lookup: {
                from: 'addressinfos',
                localField: 'address',
                foreignField: 'address',
                as: 'balance'
              }
            },
            {$addFields: {balance: {$arrayElemAt: ['$balance.balance', 0]}}}
          ]
        }
      }
    ])
    return {totalCount: count[0].count, list}
  }
}

function parseAddresses(addresses) {
  if (!Array.isArray(addresses)) {
    addresses = [addresses]
  }
  return addresses
    .filter(address => address.type)
    .map(address => {
      if (address instanceof Address) {
        return {
          type: address.type === Address.PAY_TO_PUBLIC_KEY ? Address.PAY_TO_PUBLIC_KEY_HASH : address.type,
          hex: address.data.toString('hex')
        }
      } else {
        return address
      }
    })
}

function toHexAddresses(addresses) {
  return addresses
    .filter(address => address.type === Address.PAY_TO_PUBLIC_KEY_HASH)
    .map(address => '0'.repeat(24) + address.hex)
}
