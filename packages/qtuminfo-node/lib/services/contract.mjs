import fs from 'fs'
import path from 'path'
import Sequelize from 'sequelize'
import {Address, Solidity} from 'qtuminfo-lib'
import Service from './base'

const {ne: $ne, gt: $gt, in: $in} = Sequelize.Op

const totalSupplyABI = Solidity.qrc20ABIs.find(abi => abi.name === 'totalSupply')
const balanceOfABI = Solidity.qrc20ABIs.find(abi => abi.name === 'balanceOf')
const ownerOfABI = Solidity.qrc721ABIs.find(abi => abi.name === 'ownerOf')
const transferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'transfer')
const TransferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'Transfer')

export default class ContractService extends Service {
  constructor(options) {
    super(options)
    this._contractCodeDirectory = path.resolve(this.node.datadir, 'contract-code')
  }

  static get dependencies() {
    return ['block', 'db', 'transaction']
  }

  async start() {
    this.db = this.node.getDatabase()
    this.Address = this.node.getModel('address')
    this.Transaction = this.node.getModel('transaction')
    this.TransactionOutput = this.node.getModel('transaction_output')
    this.Receipt = this.node.getModel('receipt')
    this.ReceiptLog = this.node.getModel('receipt_log')
    this.Contract = this.node.getModel('contract')
    this.ContractCode = this.node.getModel('contract_code')
    this.ContractTag = this.node.getModel('contract_tag')
    this.QRC20 = this.node.getModel('qrc20')
    this.QRC20Balance = this.node.getModel('qrc20_balance')
    this.QRC721 = this.node.getModel('qrc721')
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
    await this.onReorg(this._tip.height)
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onBlock(block) {
    if (block.height === 0) {
      for (let x of [0x80, 0x81, 0x82, 0x83, 0x84]) {
        let dgpAddress = Buffer.alloc(20)
        dgpAddress[19] = x
        let code = await this.node.getRpcClient().getcontractcode(dgpAddress.toString('hex'))
        await this.Contract.create({
          address: dgpAddress,
          addressString: new Address({
            type: Address.EVM_CONTRACT,
            data: dgpAddress,
            chain: this.chain
          }).toString(),
          vm: 'evm',
          type: 'dgp',
          owner: '0',
          createHeight: 0
        })
        await this.ContractCode.create({
          contractAddress: dgpAddress,
          code: Buffer.from(code, 'hex')
        })
        await this.ContractTag.create({
          contractAddress: dgpAddress,
          tag: 'dgp'
        })
      }
      return
    }
    for (let transaction of block.transactions) {
      for (let i = 0; i < transaction.outputs.length; ++i) {
        let output = transaction.outputs[i]
        if (output.scriptPubKey.isEVMContractCreate()) {
          let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, i).data
          let {address: owner} = await this.TransactionOutput.findOne({
            where: {inputTxId: transaction.id, inputIndex: 0},
            attributes: [],
            include: [{
              model: this.Address,
              as: 'address',
              required: true,
              attributes: ['_id', 'data']
            }]
          })
          let contract = await this._createContract(address, 'evm', {transaction, block, ownerId: owner._id})
          if (contract && contract.type === 'qrc20') {
            await this._updateBalances(new Set([`${address.toString('hex')}:${owner.data.toString('hex')}`]))
          }
        }
      }
    }
    await this._processReceipts(block)
    if (this.node.isSynced()) {
      await this._syncContracts()
    }
    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onReorg(height) {
    await this.db.query(`
      DELETE contract, code, tag, qrc20, qrc20_balance, qrc721
      FROM contract
      LEFT JOIN contract_code code ON code.contract_address = contract.address
      LEFT JOIN contract_tag tag ON tag.contract_address = contract.address
      LEFT JOIN qrc20 ON qrc20.contract_address = contract.address
      LEFT JOIN qrc20_balance ON qrc20_balance.contract_address = contract.address
      LEFT JOIN qrc721 ON qrc721.contract_address = contract.address
      WHERE create_height > ${height}
    `)
    let balanceChanges = new Set()
    let results = await this.ReceiptLog.findAll({
      where: {topic1: TransferABI.id, topic3: {[$ne]: null}, topic4: null},
      attributes: ['address', 'topic2', 'topic3'],
      include: [{
        model: this.Receipt,
        as: 'receipt',
        required: true,
        attributes: [],
        include: [{
          model: this.Transaction,
          as: 'transaction',
          required: true,
          where: {blockHeight: {[$gt]: height}},
          attributes: []
        }]
      }]
    })
    for (let {contractAddress, topic2, topic3} of results) {
      balanceChanges.add(`${contractAddress.toString('hex')}:${topic2.slice(12).toString('hex')}`)
      balanceChanges.add(`${contractAddress.toString('hex')}:${topic3.slice(12).toString('hex')}`)
    }
    await this._updateBalances(balanceChanges)
  }

  async onSynced() {
    await this._syncContracts()
  }

  async _syncContracts() {
    let result = await this.node.getRpcClient().listcontracts(1, 1e8)
    let contractsToCreate = new Set(Object.keys(result))
    let originalContracts = (await this.Contract.findAll({
      where: {},
      attributes: ['address']
    })).map(contract => contract.address.toString('hex'))
    let contractsToRemove = []
    for (let address of originalContracts) {
      if (contractsToCreate.has(address)) {
        contractsToCreate.delete(address)
      } else {
        contractsToRemove.push(address)
      }
    }
    if (contractsToRemove.length) {
      let addresses = contractsToRemove.map(address => `0x${address}`).join(', ')
      await this.db.query(`
        DELETE contract, qrc20_balance FROM contract
        LEFT JOIN qrc20_balance on qrc20_balance.contract_address = contract.address
        WHERE contract.address IN ($${addresses})
      `)
    }
    for (let address of contractsToCreate) {
      await this._createContract(Buffer.from(address, 'hex'), 'evm')
    }
  }

  async _createContract(address, vm, {transaction, block, ownerId} = {}) {
    let contract = await this.Contract.findOne({where: {address}})
    if (contract) {
      return contract
    }
    let code
    try {
      code = Buffer.from(await this.node.getRpcClient().getcontractcode(address.toString('hex')), 'hex')
    } catch (err) {
      return
    }
    contract = new this.Contract({
      address,
      addressString: new Address({
        type: Address.EVM_CONTRACT,
        data: address,
        chain: this.chain
      }).toString(),
      vm,
      ...ownerId
        ? {
          ownerId,
          createTxId: transaction.id,
          createHeight: block.height
        }
        : {}
    })
    if (isQRC721(code)) {
      let [nameResult, symbolResult, totalSupplyResult] = await this._batchCallMethods([
        {address, abi: Solidity.qrc721ABIs.find(abi => abi.name === 'name')},
        {address, abi: Solidity.qrc721ABIs.find(abi => abi.name === 'symbol')},
        {address, abi: Solidity.qrc721ABIs.find(abi => abi.name === 'totalSupply')}
      ])
      try {
        let [name, symbol, totalSupply] = await Promise.all([
          nameResult.then(x => x[0]),
          symbolResult.then(x => x[0]),
          totalSupplyResult.then(x => BigInt(x[0].toString()))
        ])
        contract.type = 'qrc721'
        await contract.save()
        await this.ContractCode.create({contractAddress: address, code})
        await this.ContractTag.create({contractAddress: address, tag: 'qrc721'})
        await this.QRC721.create({
          contractAddress: address,
          name,
          nameString: name.toString(),
          symbol,
          symbolString: symbol.toString(),
          totalSupply
        })
      } catch (err) {
        await contract.save()
      }
    } else if (isQRC20(code)) {
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
        let version
        try {
          version = (await versionResult)[0]
        } catch (err) {}
        let [name, symbol, decimals, totalSupply] = await Promise.all([
          nameResult.then(x => x[0]),
          symbolResult.then(x => x[0]),
          decimalsResult.then(x => x[0].toString()),
          totalSupplyResult.then(x => BigInt(x[0].toString()))
        ])
        contract.type = 'qrc20'
        await contract.save()
        await this.ContractCode.create({contractAddress: address, code})
        await this.ContractTag.create({contractAddress: address, tag: 'qrc20'})
        await this.QRC20.create({
          contractAddress: address,
          name,
          nameString: name.toString(),
          symbol,
          symbolString: symbol.toString(),
          decimals,
          totalSupply,
          version
        })
      } catch (err) {
        await contract.save()
      }
    } else {
      await contract.save()
    }
    return contract
  }

  async _callMethod(address, abi, ...args) {
    let {executionResult} = await this.node.getRpcClient().callcontract(
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
    let client = this.node.getRpcClient()
    let results = await client.batch(() => {
      for (let {address, abi, args = []} of callList) {
        client.callcontract(
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
    let balanceChanges = new Set()
    let totalSupplyChanges = new Set()
    let contractsToCreate = new Set()
    for (let {contractAddress, logs} of block.receipts || []) {
      for (let {address, topics} of logs) {
        if (Buffer.compare(address, contractAddress) !== 0) {
          contractsToCreate.add(address.toString('hex'))
        }
        if (topics.length >= 3 && Buffer.compare(topics[0], TransferABI.id) === 0) {
          let sender = topics[1].slice(12)
          let receiver = topics[2].slice(12)
          if (topics.length === 3) {
            balanceChanges.add(`${address.toString('hex')}:${sender.toString('hex')}`)
            balanceChanges.add(`${address.toString('hex')}:${receiver.toString('hex')}`)
          }
          if (Buffer.compare(sender, Buffer.alloc(20)) === 0 || Buffer.compare(receiver, Buffer.alloc(20)) === 0) {
            totalSupplyChanges.add(address.toString('hex'))
          }
        }
      }
    }
    if (balanceChanges.size) {
      await this._updateBalances(balanceChanges)
    }
    for (let addressString of totalSupplyChanges) {
      let address = Buffer.from(addressString, 'hex')
      let contract = await this.Contract.findOne({
        where: {
          address,
          type: {[$in]: ['qrc20', 'qrc721']}
        }
      })
      if (contract) {
        let totalSupply
        try {
          totalSupply = BigInt((await this._callMethod(address, totalSupplyABI)).toString())
        } catch (err) {
          continue
        }
        if (contract.type === 'qrc20') {
          await this.QRC20.update({totalSupply}, {where: {contractAddress: address}})
        } else {
          await this.QRC721.update({totalSupply}, {where: {contractAddress: address}})
        }
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
            contractAddress: Buffer.from(contract, 'hex'),
            address: Buffer.from(address, 'hex'),
            balance: BigInt(balance.toString())
          }
        } catch (err) {}
      })
    )
    operations = operations.filter(Boolean)
    if (operations.length) {
      await this.QRC20Balance.bulkCreate(operations, {updateOnDuplicate: ['balance'], validate: false})
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
