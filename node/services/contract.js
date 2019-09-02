const Sequelize = require('sequelize')
const {Address, OutputScript, Solidity, Hash} = require('../../lib')
const Service = require('./base')
const {sql} = require('../utils')

const {ne: $ne, gt: $gt, in: $in} = Sequelize.Op

const totalSupplyABI = Solidity.qrc20ABIs.find(abi => abi.name === 'totalSupply')
const balanceOfABI = Solidity.qrc20ABIs.find(abi => abi.name === 'balanceOf')
const ownerOfABI = Solidity.qrc721ABIs.find(abi => abi.name === 'ownerOf')
const transferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'transfer')
const TransferABI = Solidity.qrc20ABIs.find(abi => abi.name === 'Transfer')

class ContractService extends Service {
  #tip = null
  #db = null
  #Address = null
  #Transaction = null
  #TransactionInput = null
  #EVMReceipt = null
  #EVMReceiptLog = null
  #Contract = null
  #ContractCode = null
  #ContractTag = null
  #QRC20 = null
  #QRC20Balance = null
  #QRC721 = null
  #QRC721Token = null

  static get dependencies() {
    return ['block', 'db', 'transaction']
  }

  async start() {
    this.#db = this.node.getDatabase()
    this.#Address = this.node.getModel('address')
    this.#Transaction = this.node.getModel('transaction')
    this.#TransactionInput = this.node.getModel('transaction_input')
    this.#EVMReceipt = this.node.getModel('evm_receipt')
    this.#EVMReceiptLog = this.node.getModel('evm_receipt_log')
    this.#Contract = this.node.getModel('contract')
    this.#ContractCode = this.node.getModel('contract_code')
    this.#ContractTag = this.node.getModel('contract_tag')
    this.#QRC20 = this.node.getModel('qrc20')
    this.#QRC20Balance = this.node.getModel('qrc20_balance')
    this.#QRC721 = this.node.getModel('qrc721')
    this.#QRC721Token = this.node.getModel('qrc721_token')
    this.#tip = await this.node.getServiceTip(this.name)
    let blockTip = await this.node.getBlockTip()
    if (this.#tip.height > blockTip.height) {
      this.#tip = {height: blockTip.height, hash: blockTip.hash}
    }
    await this.onReorg(this.#tip.height)
    await this.node.updateServiceTip(this.name, this.#tip)
  }

  async onBlock(block) {
    if (block.height === 0) {
      for (let x of [0x80, 0x81, 0x82, 0x83, 0x84]) {
        let dgpAddress = Buffer.alloc(20)
        dgpAddress[19] = x
        let code = Buffer.from(await this.node.getRpcClient().getcontractcode(dgpAddress.toString('hex')), 'hex')
        let sha256sum = Hash.sha256(code)
        await this.#Contract.create({
          address: dgpAddress,
          addressString: new Address({
            type: Address.EVM_CONTRACT,
            data: dgpAddress,
            chain: this.chain
          }).toString(),
          vm: 'evm',
          type: 'dgp',
          bytecodeSha256sum: sha256sum,
          createHeight: 0
        })
        await this.#ContractCode.bulkCreate([{sha256sum, code}], {ignoreDuplicates: true})
        await this.#ContractTag.create({
          contractAddress: dgpAddress,
          tag: 'dgp'
        })
      }
      return
    }
    for (let transaction of block.transactions) {
      for (let i = 0; i < transaction.outputs.length; ++i) {
        let output = transaction.outputs[i]
        if (output.scriptPubKey.type === OutputScript.EVM_CONTRACT_CREATE) {
          let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, i).data
          let {address: owner} = await this.#TransactionInput.findOne({
            where: {inputIndex: 0},
            attributes: [],
            include: [
              {
                model: this.#Transaction,
                as: 'transaction',
                required: true,
                where: {id: transaction.id},
                attributes: []
              },
              {
                model: this.#Address,
                as: 'address',
                required: true,
                attributes: ['data']
              }
            ]
          })
          let contract = await this._createContract(address, 'evm')
          if (contract && contract.type === 'qrc20') {
            await this._updateBalances(new Set([`${address.toString('hex')}:${owner.data.toString('hex')}`]))
          }
        } else if (output.scriptPubKey.type === OutputScript.EVM_CONTRACT_CREATE_SENDER) {
          let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, i).data
          let owner = new Address({
            type: [
              null,
              Address.PAY_TO_PUBLIC_KEY_HASH,
              Address.PAY_TO_SCRIPT_HASH,
              Address.PAY_TO_WITNESS_SCRIPT_HASH,
              Address.PAY_TO_WITNESS_KEY_HASH
            ][output.scriptPubKey.senderType],
            data: output.scriptPubKey.senderData,
            chain: this.chain
          })
          let contract = await this._createContract(address, 'evm')
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
    this.#tip.height = block.height
    this.#tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this.#tip)
  }

  async onReorg(height) {
    let balanceChanges = new Set()
    let balanceChangeResults = await this.#EVMReceiptLog.findAll({
      where: {topic1: TransferABI.id, topic3: {[$ne]: null}, topic4: null},
      attributes: ['address', 'topic2', 'topic3'],
      include: [{
        model: this.#EVMReceipt,
        as: 'receipt',
        required: true,
        where: {blockHeight: {[$gt]: height}},
        attributes: []
      }]
    })
    for (let {address, topic2, topic3} of balanceChangeResults) {
      if (Buffer.compare(topic2, Buffer.alloc(32)) !== 0) {
        balanceChanges.add(`${address.toString('hex')}:${topic2.slice(12).toString('hex')}`)
      }
      if (Buffer.compare(topic3, Buffer.alloc(32)) !== 0) {
        balanceChanges.add(`${address.toString('hex')}:${topic3.slice(12).toString('hex')}`)
      }
    }
    if (balanceChanges.size) {
      await this._updateBalances(balanceChanges)
    }
    await this.#db.query(sql`
      INSERT INTO qrc721_token
      SELECT log.address AS contract_address, log.topic4 AS token_id, RIGHT(log.topic2, 20) AS holder
      FROM evm_receipt receipt, evm_receipt_log log
      INNER JOIN (
        SELECT address, topic4, MIN(_id) AS _id FROM evm_receipt_log
        WHERE topic4 IS NOT NULL AND topic1 = ${TransferABI.id}
        GROUP BY address, topic4
      ) results ON log._id = results._id
      WHERE receipt._id = log.receipt_id AND receipt.block_height > ${height} AND log.topic2 != ${Buffer.alloc(32)}
      ON DUPLICATE KEY UPDATE holder = VALUES(holder)
    `)
  }

  async onSynced() {
    await this._syncContracts()
  }

  async _syncContracts() {
    let result = await this.node.getRpcClient().listcontracts(1, 1e8)
    let contractsToCreate = new Set(Object.keys(result))
    let originalContracts = (await this.#Contract.findAll({
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
      await this.#db.query(sql`
        DELETE contract, tag, qrc20, qrc20_balance, qrc721, qrc721_token
        FROM contract
        LEFT JOIN contract_tag tag ON tag.contract_address = contract.address
        LEFT JOIN qrc20 ON qrc20.contract_address = contract.address
        LEFT JOIN qrc20_balance ON qrc20_balance.contract_address = contract.address
        LEFT JOIN qrc721 ON qrc721.contract_address = contract.address
        LEFT JOIN qrc721_token ON qrc721_token.contract_address = contract.address
        WHERE contract.address IN ${contractsToRemove}
      `)
    }
    for (let address of contractsToCreate) {
      await this._createContract(Buffer.from(address, 'hex'), 'evm')
    }
  }

  async _createContract(address, vm) {
    let contract = await this.#Contract.findOne({where: {address}})
    if (contract) {
      return contract
    }
    let code
    try {
      code = Buffer.from(await this.node.getRpcClient().getcontractcode(address.toString('hex')), 'hex')
    } catch (err) {
      return
    }
    let sha256sum = Hash.sha256(code)
    contract = new this.#Contract({
      address,
      addressString: new Address({
        type: Address.EVM_CONTRACT,
        data: address,
        chain: this.chain
      }).toString(),
      vm,
      bytecodeSha256sum: sha256sum
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
        await this.#ContractCode.bulkCreate([{sha256sum, code}], {ignoreDuplicates: true})
        await this.#ContractTag.create({contractAddress: address, tag: 'qrc721'})
        await this.#QRC721.create({
          contractAddress: address,
          name,
          symbol,
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
        await this.#ContractCode.bulkCreate([{sha256sum, code}], {ignoreDuplicates: true})
        await this.#ContractTag.create({contractAddress: address, tag: 'qrc20'})
        await this.#QRC20.create({
          contractAddress: address,
          name,
          symbol,
          decimals,
          totalSupply,
          version
        })
      } catch (err) {
        await contract.save()
      }
    } else {
      await contract.save()
      await this.#ContractCode.bulkCreate([{sha256sum, code}], {ignoreDuplicates: true})
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
    let tokenHolders = new Map()
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
            if (Buffer.compare(sender, Buffer.alloc(20)) !== 0) {
              balanceChanges.add(`${address.toString('hex')}:${sender.toString('hex')}`)
            }
            if (Buffer.compare(receiver, Buffer.alloc(20)) !== 0) {
              balanceChanges.add(`${address.toString('hex')}:${receiver.toString('hex')}`)
            }
          } else if (topics.length === 4) {
            if (Buffer.compare(receiver, Buffer.alloc(20)) !== 0) {
              tokenHolders.set(`${address.toString('hex')}:${topics[3].toString('hex')}`, receiver)
            }
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
    if (tokenHolders.size) {
      await this._updateTokenHolders(tokenHolders)
    }
    for (let addressString of totalSupplyChanges) {
      let address = Buffer.from(addressString, 'hex')
      let contract = await this.#Contract.findOne({
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
          await this.#QRC20.update({totalSupply}, {where: {contractAddress: address}})
        } else {
          await this.#QRC721.update({totalSupply}, {where: {contractAddress: address}})
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
      await this.#QRC20Balance.bulkCreate(operations, {updateOnDuplicate: ['balance'], validate: false})
    }
  }

  async _updateTokenHolders(transfers) {
    let operations = []
    for (let [key, holder] of transfers.entries()) {
      let [contract, tokenId] = key.split(':')
      operations.push({
        contractAddress: Buffer.from(contract, 'hex'),
        tokenId: Buffer.from(tokenId, 'hex'),
        holder
      })
    }
    await this.#QRC721Token.bulkCreate(operations, {updateOnDuplicate: ['holder'], validate: false})
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

module.exports = ContractService
