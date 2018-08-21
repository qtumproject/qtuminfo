import fs from 'fs'
import path from 'path'
import {Address, Solidity} from 'qtuminfo-lib'
import Contract from '../models/contract'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import QtumBalanceChanges from '../models/qtum-balance-changes'
import QRC20TokenBalance from '../models/qrc20-token-balance'
import Service from './base'
import {toBigInt} from '../utils'

const totalSupplyABI = Solidity.qrc20ABIs.find(abi => abi.name === 'totalSupply')
const balanceOfABI = Solidity.qrc20ABIs.find(abi => abi.name === 'balanceOf')
const ownerOfABI = Solidity.qrc721ABIs.find(abi => abi.name === 'ownerOf')
const transferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'transfer')
const TransferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'Transfer')

export default class ContractService extends Service {
  constructor(options) {
    super(options)
    this._client = this.node.getRpcClient()
    this._contractCodeDirectory = path.resolve(this.node.datadir, 'contract-code')
  }

  static get dependencies() {
    return ['block', 'db', 'transaction']
  }

  get APIMethods() {
    return {
      getContract: this.getContract.bind(this),
      getContractHistory: this.getContractHistory.bind(this),
      getContractSummary: this.getContractSummary.bind(this),
      getQRC20TokenTransfers: this.getQRC20TokenTransfers.bind(this),
      getQRC721TokenTransfers: this.getQRC721TokenTransfers.bind(this),
      getAddressQRC20TokenBalanceHistory: this.getAddressQRC20TokenBalanceHistory.bind(this),
      listQRC20Tokens: this.listQRC20Tokens.bind(this),
      getAllQRC20TokenBalances: this.getAllQRC20TokenBalances.bind(this),
      searchQRC20Token: this.searchQRC20Token.bind(this),
      getQRC20TokenRichList: this.getQRC20TokenRichList.bind(this)
    }
  }

  async getContract(address) {
    let contract = await Contract.findOne({address}, '-_id')
    return {
      address: contract.address.toString('hex'),
      owner: contract.owner && new Address({
        type: contract.owner.type,
        data: contract.owner.hex,
        chain: this.chain
      }),
      createTransactionId: contract.createTransactionId,
      createHeight: contract.createHeight,
      type: contract.type,
      ...contract.qrc20
        ? {qrc20: parseQRC20(contract.qrc20)}
        : {},
      ...contract.qrc721
        ? {qrc721: parseQRC721(contract.qrc721)}
        : {}
    }
  }

  async getContractHistory(address, {from = 0, limit = 100, reversed = true} = {}) {
    address = address.toString('hex')
    let sort = reversed ? {'block.height': -1, index: -1} : {'block.height': 1, index: 1}
    let [{count, list}] = await Transaction.aggregate([
      {
        $match: {
          $or: [
            {relatedAddresses: {type: Address.CONTRACT, hex: address}},
            {'receipts.contractAddress': address},
            {
              'receipts.logs': {
                $elemMatch: {
                  $or: [
                    {address},
                    {
                      $and: [
                        {topics: TransferABI.id.toString('hex')},
                        {topics: '0'.repeat(24) + address},
                        {'topics.0': TransferABI.id.toString('hex')},
                        {
                          $or: [
                            {'topics.1': '0'.repeat(24) + address},
                            {'topics.2': '0'.repeat(24) + address}
                          ]
                        }
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
            {
              $project: {
                _id: false,
                id: true
              }
            }
          ]
        }
      }
    ])
    return {
      totalCount: count[0].count,
      transactions: list.map(tx => Buffer.from(tx.id, 'hex'))
    }
  }

  async getContractSummary(address) {
    address = address.toString('hex')
    let totalCount = await Transaction.countDocuments({
      $or: [
        {relatedAddresses: {type: Address.CONTRACT, hex: address}},
        {'receipts.contractAddress': address},
        {
          'receipts.logs': {
            $elemMatch: {
              $or: [
                {address},
                {
                  $and: [
                    {topics: TransferABI.id.toString('hex')},
                    {topics: '0'.repeat(24) + address},
                    {'topics.0': TransferABI.id.toString('hex')},
                    {
                      $or: [
                        {'topics.1': '0'.repeat(24) + address},
                        {'topics.2': '0'.repeat(24) + address}
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    })
    if (totalCount === 0) {
      return {
        balance: 0n,
        totalReceived: 0n,
        totalSent: 0n,
        totalCount: 0
      }
    }

    let [balanceChangesResult] = await QtumBalanceChanges.aggregate([
      {
        $match: {
          address: {type: Address.CONTRACT, hex: address},
          value: {$ne: 0}
        }
      },
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
    if (balanceChangesResult) {
      let totalReceived = toBigInt(balanceChangesResult.totalReceived)
      let totalSent = toBigInt(balanceChangesResult.totalSent)
      return {
        balance: totalReceived - totalSent,
        totalReceived,
        totalSent,
        totalCount
      }
    } else {
      return {
        balance: 0n,
        totalReceived: 0n,
        totalSent: 0n,
        totalCount
      }
    }
  }

  async getQRC20TokenTransfers(transaction) {
    let list = []
    let tokenCache = {}
    let addressCache = {}
    for (let receipt of transaction.receipts) {
      for (let {address, topics, data} of receipt.logs) {
        if (Buffer.compare(topics[0], TransferABI.id) !== 0 || topics.length !== 3 || data.length !== 32) {
          continue
        }
        let addressString = address.toString('hex')
        let token
        if (addressString in tokenCache) {
          token = tokenCache[addressString]
        } else {
          let contract = await Contract.findOne({address, type: 'qrc20'})
          if (!contract) {
            continue
          }
          tokenCache[addressString] = token = {address, ...parseQRC20(contract.qrc20)}
        }
        let fromString = topics[1].slice(12).toString('hex')
        let toString = topics[2].slice(12).toString('hex')
        let from
        let to
        if (fromString in addressCache) {
          from = addressCache[fromString]
        } else {
          addressCache[fromString] = from = await this._fromHexAddress(fromString)
        }
        if (toString in addressCache) {
          to = addressCache[toString]
        } else {
          addressCache[toString] = to = await this._fromHexAddress(toString)
        }
        list.push({
          token,
          from, to,
          amount: BigInt(`0x${data.toString('hex')}`)
        })
      }
    }
    return list
  }

  async getQRC721TokenTransfers(transaction) {
    let list = []
    let tokenCache = {}
    let addressCache = {}
    for (let receipt of transaction.receipts) {
      for (let {address, topics} of receipt.logs) {
        if (Buffer.compare(topics[0], TransferABI.id) !== 0 || topics.length !== 4) {
          continue
        }
        let addressString = address.toString('hex')
        let token
        if (addressString in tokenCache) {
          token = tokenCache[addressString]
        } else {
          let contract = await Contract.findOne({address, type: 'qrc721'})
          if (!contract) {
            continue
          }
          tokenCache[addressString] = token = {address, ...parseQRC721(contract.qrc721)}
        }
        let fromString = topics[1].slice(12).toString('hex')
        let toString = topics[2].slice(12).toString('hex')
        let from
        let to
        if (fromString in addressCache) {
          from = addressCache[fromString]
        } else {
          addressCache[fromString] = from = await this._fromHexAddress(fromString)
        }
        if (toString in addressCache) {
          to = addressCache[toString]
        } else {
          addressCache[toString] = to = await this._fromHexAddress(toString)
        }
        list.push({
          token,
          from, to,
          tokenId: topics[3]
        })
      }
    }
    return list
  }

  async getAddressQRC20TokenBalanceHistory(addresses, tokens, {from = 0, limit = 100, reversed = true} = {}) {
    if (!Array.isArray(addresses)) {
      addresses = [addresses]
    }
    let hexAddresses = addresses
      .filter(address => [Address.PAY_TO_PUBLIC_KEY_HASH, Address.CONTRACT].includes(address.type))
      .map(address => '0'.repeat(24) + address.data.toString('hex'))
    addresses = addresses.map(address => address.data.toString('hex'))
    if (tokens !== 'all') {
      tokens = tokens.map(token => token.toString('hex'))
    }
    let sort = reversed ? {'block.height': -1, index: -1} : {'block.height': 1, index: 1}

    let [{count, list}] = await Transaction.aggregate([
      {
        $match: {
          'receipts.logs': {
            $elemMatch: {
              ...tokens === 'all' ? {} : {address: {$in: tokens}},
              $and: [
                {topics: TransferABI.id.toString('hex')},
                {topics: {$size: 3}},
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
      },
      {
        $facet: {
          count: [{$count: 'count'}],
          list: [
            {$sort: sort},
            {$skip: from},
            {$limit: limit},
            {$unwind: '$receipts'},
            {$unwind: '$receipts.logs'},
            {
              $project: {
                _id: false,
                id: '$id',
                block: '$block',
                log: '$receipts.logs'
              }
            },
            {
              $match: {
                ...tokens === 'all' ? {} : {'log.address': {$in: tokens}},
                $and: [
                  {'log.topics': TransferABI.id.toString('hex')},
                  {'log.topics': {$size: 3}},
                  {'log.topics': {$in: hexAddresses}},
                  {'log.topics.0': TransferABI.id.toString('hex')},
                  {
                    $or: [
                      {'log.topics.1': {$in: hexAddresses}},
                      {'log.topics.2': {$in: hexAddresses}}
                    ]
                  }
                ]
              }
            },
            {
              $lookup: {
                from: 'contracts',
                localField: 'log.address',
                foreignField: 'address',
                as: 'token'
              }
            },
            {$match: {'token.type': 'qrc20'}},
            {$unwind: '$token'},
            {
              $group: {
                _id: '$id',
                block: {$first: '$block'},
                index: {$first: '$index'},
                logs: {
                  $push: {
                    token: {
                      address: '$token.address',
                      name: '$token.qrc20.name',
                      symbol: '$token.qrc20.symbol',
                      decimals: '$token.qrc20.decimals',
                      totalSupply: '$token.qrc20.totalSupply',
                      version: '$token.qrc20.version'
                    },
                    topics: '$log.topics',
                    data: '$log.data'
                  }
                }
              }
            },
            {$sort: sort},
            {
              $project: {
                _id: false,
                id: '$_id',
                block: '$block',
                logs: '$logs'
              }
            }
          ]
        }
      }
    ])

    return {
      totalCount: count.length && count[0].count,
      transactions: list.map(({id, block, logs}) => {
        let tokens = {}
        for (let {token, topics, data} of logs) {
          let delta = 0n
          if (hexAddresses.includes(topics[1])) {
            delta -= BigInt(`0x${data.toString('hex')}`)
          }
          if (hexAddresses.includes(topics[2])) {
            delta += BigInt(`0x${data.toString('hex')}`)
          }
          if (token.address in tokens) {
            tokens[token.address].amount += delta
          } else {
            tokens[token.address] = {token, amount: delta}
          }
        }
        return {
          id: Buffer.from(id, 'hex'),
          block: {
            hash: Buffer.from(block.hash, 'hex'),
            height: block.height,
            timestamp: block.timestamp
          },
          data: [...Object.values(tokens)].map(({token, amount}) => ({
            token: {
              address: Buffer.from(token.address, 'hex'),
              ...parseQRC20(token)
            },
            amount
          }))
        }
      })
    }
  }

  async listQRC20Tokens({from = 0, limit = 100}) {
    let [{count, list}] = await QRC20TokenBalance.aggregate([
      {
        $match: {
          address: {$ne: '0'.repeat(40)},
          balance: {$ne: '0'.repeat(64)}
        }
      },
      {
        $group: {
          _id: '$contract',
          holders: {$sum: 1}
        }
      },
      {$match: {holders: {$ne: 0}}},
      {
        $facet: {
          count: [{$count: 'count'}],
          list: [
            {
              $project: {
                _id: false,
                contract: '$_id',
                holders: '$holders'
              }
            },
            {$sort: {holders: -1}},
            {$skip: from},
            {$limit: limit},
            {
              $lookup: {
                from: 'contracts',
                localField: 'contract',
                foreignField: 'address',
                as: 'contract'
              }
            },
            {
              $project: {
                address: {$arrayElemAt: ['$contract.address', 0]},
                qrc20: {$arrayElemAt: ['$contract.qrc20', 0]},
                holders: '$holders'
              }
            }
          ]
        }
      }
    ])
    return {
      totalCount: count.length && count[0].count,
      tokens: list.map(({address, qrc20, holders}) => ({
        address: Buffer.from(address, 'hex'),
        ...parseQRC20(qrc20),
        holders
      }))
    }
  }

  async getAllQRC20TokenBalances(addresses) {
    if (!Array.isArray(addresses)) {
      addresses = [addresses]
    }
    let hexAddresses = addresses
      .filter(address => [Address.PAY_TO_PUBLIC_KEY_HASH, Address.CONTRACT].includes(address.type))
      .map(address => address.data.toString('hex'))
    let list = await QRC20TokenBalance.aggregate([
      {
        $match: {
          address: {$in: hexAddresses},
          balance: {$ne: '0'.repeat(64)}
        }
      },
      {
        $group: {
          _id: '$contract',
          balances: {$push: '$balance'}
        }
      },
      {
        $project: {
          _id: false,
          contract: '$_id',
          balances: '$balances'
        }
      },
      {
        $lookup: {
          from: 'contracts',
          localField: 'contract',
          foreignField: 'address',
          as: 'contract'
        }
      },
      {
        $project: {
          address: {$arrayElemAt: ['$contract.address', 0]},
          qrc20: {$arrayElemAt: ['$contract.qrc20', 0]},
          balances: '$balances'
        }
      }
    ])
    return list.map(({address, qrc20, balances}) => {
      let sum = 0n
      for (let balance of balances) {
        sum += BigInt(`0x${balance}`)
      }
      return {
        address: Buffer.from(address, 'hex'),
        ...parseQRC20(qrc20),
        balance: sum
      }
    })
  }

  async searchQRC20Token(name, {limit = 1} = {}) {
    let regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    let result = await Contract.aggregate([
      {
        $match: {
          $or: [
            {'qrc20.name': regex},
            {'qrc20.symbol': regex}
          ]
        }
      },
      {
        $project: {
          address: '$address',
          qrc20: '$qrc20'
        }
      },
      {
        $lookup: {
          from: 'qrc20tokenbalances',
          localField: 'address',
          foreignField: 'contract',
          as: 'balance'
        }
      },
      {$unwind: '$balance'},
      {
        $match: {
          'balance.address': {$ne: '0'.repeat(40)},
          'balance.balance': {$ne: '0'.repeat(64)}
        }
      },
      {
        $group: {
          _id: '$address',
          qrc20: {$first: '$qrc20'},
          holders: {$sum: 1}
        }
      },
      {$sort: {holders: -1}},
      {$limit: limit},
      {
        $project: {
          _id: false,
          address: '$_id',
          qrc20: '$qrc20',
          holders: '$holders'
        }
      }
    ])
    return result.map(({address, qrc20, holders}) => ({
      address: Buffer.from(address, 'hex'),
      ...parseQRC20(qrc20),
      holders
    }))
  }

  async getQRC20TokenRichList(token, {from = 0, limit = 100} = {}) {
    token = token.toString('hex')
    let totalCount = await QRC20TokenBalance.countDocuments({
      contract: token,
      balance: {$ne: '0'.repeat(64)}
    })
    let list = await QRC20TokenBalance.collection
      .find(
        {contract: token, balance: {$ne: '0'.repeat(64)}},
        {
          sort: {balance: -1},
          skip: from,
          limit,
          projection: {_id: false, address: true, balance: true}
        }
      )
      .map(({address, balance}) => ({
        address: new Address({
          type: Address.PAY_TO_PUBLIC_KEY_HASH,
          data: Buffer.from(address, 'hex'),
          chain: this.chain
        }),
        balance: BigInt(`0x${balance}`)
      }))
      .toArray()
    return {totalCount, list}
  }

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = await this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
    }
    try {
      await fs.promises.access(this._contractCodeDirectory)
    } catch (err) {
      await fs.promises.mkdir(this._contractCodeDirectory)
    }
    for (let x of [0x80, 0x81, 0x82, 0x83, 0x84]) {
      let dgpAddress = Buffer.alloc(20)
      dgpAddress[19] = x
      await Contract.updateOne(
        {address: dgpAddress},
        {createHeight: 0, type: 'dgp', tags: ['dgp']},
        {upsert: true}
      )
    }
    await Contract.deleteMany({createHeight: {$gt: this._tip.height}})
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onBlock(block) {
    if (block.height === 0) {
      return
    }
    for (let transaction of block.transactions) {
      for (let i = 0; i < transaction.outputs.length; ++i) {
        let output = transaction.outputs[i]
        if (output.scriptPubKey.isContractCreate()) {
          let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, i).data
          let code = null
          try {
            code = await this._client.getcontractcode(address.toString('hex'))
          } catch (err) {}
          if (code == null) {
            continue
          }
          let {address: ownerAddress} = await TransactionOutput.findOne({
            'input.transactionId': transaction.id.toString('hex'),
            'input.index': 0
          }, '-_id address')
          let owner
          if (ownerAddress) {
            owner = new Address({
              type: ownerAddress.type,
              data: Buffer.from(ownerAddress.hex, 'hex'),
              chain: this.chain
            })
          }
          if ((await this._createContract(
            address,
            {
              transaction,
              block,
              owner,
              code: Buffer.from(code, 'hex')
            }
          )).qrc20) {
            this._updateBalances(new Set([`${address.toString('hex')}:${owner.data.toString('hex')}`]))
          }
        }
      }
    }
    await this._processReceipts(block)
    if (this._synced) {
      await this._syncContracts()
    }
    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onReorg(height) {
    let contracts = await Contract.collection
      .find(
        {createHeight: {$gt: height}},
        {projection: {_id: false, address: true}}
      )
      .map(document => document.address)
      .toArray()
    await Contract.deleteMany({createHeight: {$gt: height}})
    await QRC20TokenBalance.deleteMany({contract: {$in: contracts}})
    let balanceChanges = new Set()
    let transfers = await Transaction.aggregate([
      {
        $match: {
          'block.height': {$gt: height},
          'receipts.logs.topics.0': TransferABI.id.toString('hex')
        }
      },
      {$unwind: '$receipts'},
      {$unwind: '$receipts.logs'},
      {
        $project: {
          _id: false,
          address: '$receipts.logs.address',
          topics: '$receipts.logs.topics'
        }
      },
      {$match: {'topics.0': TransferABI.id.toString('hex')}}
    ])
    for (let {address, topics} of transfers) {
      if (topics.length === 3) {
        balanceChanges.add(`${address}:${topics[1].slice(24)}`)
        balanceChanges.add(`${address}:${topics[2].slice(24)}`)
      }
    }
    await this._updateBalances(balanceChanges)
  }

  async onSynced() {
    this._synced = true
    await this._syncContracts()
  }

  async _syncContracts() {
    let result = await this._client.listcontracts(1, 1e8)
    let contractsToCreate = new Set(Object.keys(result))
    let originalContracts = await Contract.collection
      .find({}, {projection: {_id: false, address: true}})
      .map(document => document.address)
      .toArray()
    let contractsToRemove = []
    for (let address of originalContracts) {
      if (contractsToCreate.has(address)) {
        contractsToCreate.delete(address)
      } else {
        contractsToRemove.push(address)
      }
    }
    await Contract.deleteMany({address: {$in: contractsToRemove}})
    await QRC20TokenBalance.deleteMany({contract: {$in: contractsToRemove}})
    for (let address of contractsToCreate) {
      await this._createContract(Buffer.from(address, 'hex'))
    }
  }

  async _createContract(address, {transaction, block, owner, code} = {}) {
    let addressString = address.toString('hex')
    let contract = await Contract.findOne({address: addressString})
    if (contract) {
      return contract
    }
    if (!code) {
      code = Buffer.from(await this._client.getcontractcode(addressString), 'hex')
    }
    contract = new Contract({
      address,
      ...owner
        ? {
          owner,
          createTransactionId: transaction.id,
          createHeight: block.height
        }
        : {}
    })
    await fs.promises.writeFile(
      path.resolve(this._contractCodeDirectory, `${addressString}.code`),
      code
    )
    if (isQRC721(code)) {
      contract.type = 'qrc721'
      contract.tags = ['qrc721']
      contract.qrc721 = {}
      let [nameResult, symbolResult, totalSupplyResult] = await this._batchCallMethods([
        {address, abi: Solidity.qrc721ABIs.find(abi => abi.name === 'name')},
        {address, abi: Solidity.qrc721ABIs.find(abi => abi.name === 'symbol')},
        {address, abi: Solidity.qrc721ABIs.find(abi => abi.name === 'totalSupply')}
      ])
      try {
        contract.qrc721.name = (await nameResult)[0]
      } catch (err) {}
      try {
        contract.qrc721.symbol = (await symbolResult)[0]
      } catch (err) {}
      try {
        contract.qrc721.totalSupply = BigInt((await totalSupplyResult)[0].toString())
      } catch (err) {}
    } else if (isQRC20(code)) {
      contract.type = 'qrc20'
      contract.tags = ['qrc20']
      contract.qrc20 = {}
      let [
        nameResult, symbolResult, decimalsResult, totalSupplyResult, versionResult
      ] = await this._batchCallMethods([
        {address, abi: Solidity.qrc20ABIs.find(abi => abi.name === 'name')},
        {address, abi: Solidity.qrc20ABIs.find(abi => abi.name === 'symbol')},
        {address, abi: Solidity.qrc20ABIs.find(abi => abi.name === 'decimals')},
        {address, abi: Solidity.qrc20ABIs.find(abi => abi.name === 'totalSupply')},
        {address, abi: Solidity.qrc20ABIs.find(abi => abi.name === 'version')}
      ])
      try {
        contract.qrc20.name = (await nameResult)[0]
      } catch (err) {}
      try {
        contract.qrc20.symbol = (await symbolResult)[0]
      } catch (err) {}
      try {
        contract.qrc20.decimals = (await decimalsResult)[0].toNumber()
      } catch (err) {}
      try {
        contract.qrc20.totalSupply = BigInt((await totalSupplyResult)[0].toString())
      } catch (err) {}
      try {
        contract.qrc20.version = (await versionResult)[0]
      } catch (err) {}
    }
    return await contract.save()
  }

  async _callMethod(address, abi, ...args) {
    let {executionResult} = await this._client.callcontract(
      address.toString('hex'),
      Buffer.concat([abi.id, abi.encodeInputs(args)]).toString('hex')
    )
    if (executionResult.excepted === 'None') {
      return abi.decodeOutputs(Buffer.from(executionResult.output, 'hex'))
    } else {
      throw executionResult.excepted
    }
  }

  async _batchCallMethods(callList) {
    let results = await this._client.batch(() => {
      for (let {address, abi, args = []} of callList) {
        this._client.callcontract(
          address.toString('hex'),
          Buffer.concat([abi.id, abi.encodeInputs(args)]).toString('hex')
        )
      }
    })
    return results.map(async (result, index) => {
      let {abi} = callList[index]
      let {executionResult} = await result
      if (executionResult.excepted === 'None') {
        return abi.decodeOutputs(Buffer.from(executionResult.output, 'hex'))
      } else {
        throw executionResult.excepted
      }
    })
  }

  async _processReceipts(block) {
    let receiptIndices = []
    for (let i = 0; i < block.transactions.length; ++i) {
      let tx = block.transactions[i]
      if (tx.outputs.some(
        output => output.scriptPubKey.isContractCreate() || output.scriptPubKey.isContractCall()
      )) {
        receiptIndices.push(i)
      }
    }
    if (receiptIndices.length === 0) {
      return
    }
    let blockReceipts = await Promise.all(
      await this._client.batch(() => {
        for (let index of receiptIndices) {
          this._client.gettransactionreceipt(block.transactions[index].id.toString('hex'))
        }
      })
    )
    let balanceChanges = new Set()
    let totalSupplyChanges = new Set()
    for (let index = 0; index < receiptIndices.length; ++index) {
      let tx = block.transactions[receiptIndices[index]]
      await Transaction.updateOne(
        {id: tx.id},
        {
          receipts: blockReceipts[index].map(receipt => ({
            gasUsed: receipt.gasUsed,
            contractAddress: Buffer.from(receipt.contractAddress, 'hex'),
            excepted: receipt.excepted,
            logs: receipt.log.map(({address, topics, data}) => ({
              address: Buffer.from(address, 'hex'),
              topics: topics.map(topic => Buffer.from(topic, 'hex')),
              data: Buffer.from(data, 'hex')
            }))
          }))
        }
      )
      for (let {contractAddress, log} of blockReceipts[index]) {
        for (let {address, topics} of log) {
          if (address !== contractAddress) {
            await this._createContract(Buffer.from(address, 'hex'))
          }
          if (Buffer.compare(Buffer.from(topics[0], 'hex'), TransferABI.id) === 0) {
            if (topics.length === 3) {
              balanceChanges.add(`${address}:${topics[1].slice(24)}`)
              balanceChanges.add(`${address}:${topics[2].slice(24)}`)
            }
            if (topics[1] === '0'.repeat(64) || topics[2] === '0'.repeat(64)) {
              totalSupplyChanges.add(address)
            }
          }
        }
      }
    }
    if (balanceChanges.size) {
      await this._updateBalances(balanceChanges)
    }
    for (let address of totalSupplyChanges) {
      let contract = await Contract.findOne({address, type: {$in: ['qrc20', 'qrc721']}})
      if (contract) {
        try {
          let [totalSupply] = await this._callMethod(Buffer.from(address, 'hex'), totalSupplyABI)
          contract.qrc20.totalSupply = BigInt(totalSupply.toString())
        } catch (err) {
          continue
        }
        await contract.save()
      }
    }
  }

  async _updateBalances(balanceChanges) {
    balanceChanges = [...balanceChanges].map(item => {
      let [contract, address] = item.split(':')
      return {contract, address}
    })
    let batchCalls = balanceChanges.map(({contract, address}) => ({
      address: Buffer.from(contract, 'hex'),
      abi: balanceOfABI,
      args: [`0x${address}`]
    }))
    let result = await this._batchCallMethods(batchCalls)
    let operations = await Promise.all(
      balanceChanges.map(async ({contract, address}, index) => {
        try {
          let [balance] = await result[index]
          return {
            updateOne: {
              filter: {contract, address},
              update: {$set: {balance: balance.toString(16).padStart(64, '0')}},
              upsert: true
            }
          }
        } catch (err) {}
      })
    )
    operations = operations.filter(Boolean)
    if (operations.length) {
      await QRC20TokenBalance.collection.bulkWrite(operations)
    }
  }

  async _fromHexAddress(string) {
    if (await Contract.collection.findOne({address: string}, {projection: {_id: true}})) {
      return new Address({
        type: Address.CONTRACT,
        data: Buffer.from(string, 'hex'),
        chain: this.chain
      })
    } else {
      return new Address({
        type: Address.PAY_TO_PUBLIC_KEY_HASH,
        data: Buffer.from(string, 'hex'),
        chain: this.chain
      })
    }
  }
}

function isQRC20(code) {
  return code.includes(balanceOfABI.id)
    && code.includes(transferABI.id)
    && code.includes(TransferABI.id)
}

function isQRC721(code) {
  return code.includes(balanceOfABI.id)
    && code.includes(ownerOfABI.id)
    && code.includes(TransferABI.id)
}

function parseQRC20(token) {
  let totalSupply
  if (typeof token.totalSupply === 'string') {
    totalSupply = BigInt(`0x${token.totalSupply}`)
  } else if (token.totalSupply) {
    totalSupply = token.totalSupply
  }
  return {
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    totalSupply,
    version: token.version
  }
}

function parseQRC721(token) {
  let totalSupply
  if (typeof token.totalSupply === 'string') {
    totalSupply = BigInt(`0x${token.totalSupply}`)
  } else if (token.totalSupply) {
    totalSupply = token.totalSupply
  }
  return {
    name: token.name,
    symbol: token.symbol,
    totalSupply
  }
}
