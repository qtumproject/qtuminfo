import fs from 'fs'
import path from 'path'
import {Address, Solidity} from 'qtuminfo-lib'
import Contract from '../models/contract'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import QRC20TokenBalance from '../models/qrc20-token-balance'
import Service from './base'

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

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = await this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
      await this.node.updateServiceTip(this.name, this._tip)
    }
    try {
      await fs.promises.access(this._contractCodeDirectory)
    } catch (err) {
      await fs.promises.mkdir(this._contractCodeDirectory)
    }
    for (let x of [0x80, 0x81, 0x82, 0x83, 0x84]) {
      let dgpAddress = Buffer.alloc(20)
      dgpAddress[19] = x
      await Contract.findOneAndUpdate(
        {address: dgpAddress},
        {createHeight: 0, type: 'dgp', tags: ['dgp']},
        {upsert: true}
      )
    }
    await Contract.deleteMany({createHeight: {$gt: this._tip.height}})
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
          }, 'address')
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
    let contracts = (await Contract.find({createHeight: {$gt: height}}, 'address', {lean: true}))
      .map(contract => contract.address)
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
    let originalContracts = await Contract.find({}, 'address', {lean: true})
    let contractsToRemove = []
    for (let {address} of originalContracts) {
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
      await Transaction.findOneAndUpdate(
        {id: tx.id.toString('hex')},
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
