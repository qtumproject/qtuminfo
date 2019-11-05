const Sequelize = require('sequelize')
const uuidv4 = require('uuid/v4')
const {Address, Opcode, OutputScript} = require('../../lib')
const Service = require('./base')
const {sql} = require('../utils')

const {gt: $gt, in: $in} = Sequelize.Op

class TransactionService extends Service {
  #tip = null
  #synced = false
  #db = null
  #Address = null
  #Transaction = null
  #Witness = null
  #TransactionOutput = null
  #TransactionInput = null
  #TransactionOutputMapping = null
  #BalanceChange = null
  #GasRefund = null
  #ContractSpend = null
  #EVMReceipt = null
  #EVMReceiptLog = null
  #EVMReceiptMapping = null

  static get dependencies() {
    return ['block', 'db']
  }

  async start() {
    this.#db = this.node.getDatabase()
    this.#Address = this.node.getModel('address')
    this.#Transaction = this.node.getModel('transaction')
    this.#Witness = this.node.getModel('witness')
    this.#TransactionOutput = this.node.getModel('transaction_output')
    this.#TransactionInput = this.node.getModel('transaction_input')
    this.#TransactionOutputMapping = this.node.getModel('transaction_output_mapping')
    this.#BalanceChange = this.node.getModel('balance_change')
    this.#GasRefund = this.node.getModel('gas_refund')
    this.#ContractSpend = this.node.getModel('contract_spend')
    this.#EVMReceipt = this.node.getModel('evm_receipt')
    this.#EVMReceiptLog = this.node.getModel('evm_receipt_log')
    this.#EVMReceiptMapping = this.node.getModel('evm_receipt_mapping')
    this.#tip = await this.node.getServiceTip(this.name)
    let blockTip = this.node.getBlockTip()
    if (this.#tip.height > blockTip.height) {
      this.#tip = {height: blockTip.height, hash: blockTip.hash}
    }
    await this.#TransactionOutput.destroy({where: {blockHeight: {[$gt]: this.#tip.height}}})
    await this.#db.query(sql`
      UPDATE transaction_output output, transaction_input input
      SET output.input_id = 0, output.input_index = 0xffffffff, output.input_height = NULL
      WHERE output.transaction_id = input.output_id AND output.output_index = input.output_index AND input.block_height > ${this.#tip.height}
    `)
    await this.#TransactionInput.destroy({where: {blockHeight: {[$gt]: this.#tip.height}}})
    await this.#db.query(sql`
      DELETE tx, witness, receipt, log, refund, contract_spend, balance
      FROM transaction tx
      LEFT JOIN witness ON witness.transaction_id = tx.id
      LEFT JOIN evm_receipt receipt ON receipt.transaction_id = tx._id
      LEFT JOIN evm_receipt_log log ON log.receipt_id = receipt._id
      LEFT JOIN gas_refund refund ON refund.transaction_id = tx.id
      LEFT JOIN contract_spend ON contract_spend.source_id = tx.id
      LEFT JOIN balance_change balance ON balance.transaction_id = tx._id
      WHERE tx.block_height > ${this.#tip.height}
    `)
    await this.#Address.destroy({where: {createHeight: {[$gt]: this.#tip.height}}})
    await this.#TransactionOutputMapping.destroy({truncate: true})
    await this.#EVMReceiptMapping.destroy({truncate: true})
    await this.node.updateServiceTip(this.name, this.#tip)
  }

  async onReorg(height) {
    await this.#db.query(sql`
      UPDATE transaction tx, transaction_output output, transaction_input input
      SET output.input_id = 0, output.input_index = 0xffffffff, output.input_height = NULL
      WHERE input.transaction_id = tx._id AND tx.block_height > ${Math.max(height, this.chain.lastPoWBlockHeight)} AND tx.index_in_block = 1
        AND output.transaction_id = input.output_id AND output.output_index = input.output_index
    `)
    await this.#db.query(sql`
      DELETE refund, contract_spend
      FROM transaction tx
      LEFT JOIN gas_refund refund ON refund.transaction_id = tx._id
      LEFT JOIN contract_spend ON contract_spend.source_id = tx._id
      WHERE tx.block_height > ${height}
    `)
    await this.#db.query(sql`
      DELETE tx, witness, output, input, balance
      FROM transaction tx
      LEFT JOIN witness ON witness.transaction_id = tx.id
      LEFT JOIN transaction_output output ON output.transaction_id = tx._id
      LEFT JOIN transaction_input input ON input.transaction_id = tx._id
      LEFT JOIN balance_change balance ON balance.transaction_id = tx._id
      WHERE tx.block_height > ${height} AND tx.index_in_block < 2
        AND (tx.index_in_block = 0 OR tx.block_height > ${this.chain.lastPoWBlockHeight})
    `)
    await this.#Transaction.update(
      {blockHeight: 0xffffffff, indexInBlock: 0xffffffff},
      {where: {blockHeight: {[$gt]: height}}}
    )
    await this.#TransactionOutput.update({blockHeight: 0xffffffff}, {where: {blockHeight: {[$gt]: height}}})
    await this.#EVMReceipt.update({blockHeight: 0xffffffff, indexInBlock: 0xffffffff}, {where: {blockHeight: {[$gt]: height}}})
    await this.#EVMReceiptLog.destroy({where: {blockHeight: {[$gt]: height}}})
    await this.#db.query(sql`
      UPDATE transaction_output output, transaction_input input
      SET output.input_height = 0xffffffff, input.block_height = 0xffffffff
      WHERE input.block_height > ${height} AND output.transaction_id = input.output_id AND output.output_index = input.output_index
    `)
    await this.#db.query(sql`
      UPDATE balance_change balance, transaction tx
      SET balance.block_height = 0xffffffff, balance.index_in_block = 0xffffffff
      WHERE balance.transaction_id = tx._id AND tx.block_height > ${height}
    `)
    await this.#Address.update({createHeight: 0xffffffff}, {where: {createHeight: {[$gt]: height}}})
  }

  async onBlock(block) {
    if (this.node.stopping) {
      return
    }
    try {
      let newTransactions = await this._processBlock(block)
      await this.processTxos(newTransactions, block)
      if (this.#synced) {
        await this.processBalanceChanges({block, transactions: newTransactions})
      } else {
        await this.processBalanceChanges({block})
      }
      await this.processReceipts(newTransactions)
      await this._processContracts(block)
      this.#tip.height = block.height
      this.#tip.hash = block.hash
      await this.node.updateServiceTip(this.name, this.#tip)
    } catch (err) {
      this.logger.error('Transaction Service:', err)
      this.node.stop()
    }
  }

  async onSynced() {
    this.#synced = true
  }

  async _processBlock(block) {
    let newTransactions = []
    let txs = []
    let witnesses = []
    if (this.#synced) {
      let mempoolTransactions = await this.#Transaction.findAll({
        where: {id: {[$in]: block.transactions.slice(block.height > this.chain.lastPoWBlockHeight ? 2 : 1).map(tx => tx.id)}},
        attributes: ['_id', 'id']
      })
      let mempoolTransactionsSet = new Set()
      if (mempoolTransactions.length) {
        let ids = mempoolTransactions.map(tx => tx.id)
        let _ids = mempoolTransactions.map(tx => tx._id)
        mempoolTransactionsSet = new Set(ids.map(id => id.toString('hex')))
        await Promise.all([
          this.#TransactionOutput.update(
            {blockHeight: block.height},
            {where: {transactionId: {[$in]: _ids}}}
          ),
          this.#TransactionInput.update(
            {blockHeight: block.height},
            {where: {transactionId: {[$in]: _ids}}}
          )
        ])
        await this.#db.query(sql`
          UPDATE transaction_output output, transaction_input input
          SET output.input_height = ${block.height}
          WHERE input.transaction_id IN ${_ids} AND output.transaction_id = input.output_id AND output.output_index = input.output_index
        `)
        await this.#db.query(sql`
          UPDATE address, transaction_output output
          SET address.create_height = LEAST(address.create_height, ${block.height})
          WHERE address._id = output.address_id AND output.transaction_id IN ${_ids}
        `)
      }

      for (let index = 0; index < block.transactions.length; ++index) {
        let tx = block.transactions[index]
        tx.blockHeight = block.height
        tx.indexInBlock = index
        txs.push({
          id: tx.id,
          hash: tx.hash,
          version: tx.version,
          flag: tx.flag,
          lockTime: tx.lockTime,
          blockHeight: block.height,
          indexInBlock: index,
          size: tx.size,
          weight: tx.weight
        })
        if (mempoolTransactionsSet.has(tx.id.toString('hex'))) {
          continue
        }
        if (index > 0) {
          await this.removeReplacedTransactions(tx)
        }
        newTransactions.push(tx)
        witnesses.push(...this.groupWitnesses(tx))
      }
      await this.#Transaction.bulkCreate(txs, {
        updateOnDuplicate: ['blockHeight', 'indexInBlock'],
        validate: false
      })
    } else {
      for (let index = 0; index < block.transactions.length; ++index) {
        let tx = block.transactions[index]
        tx.blockHeight = block.height
        tx.indexInBlock = index
        newTransactions.push(tx)
        txs.push({
          id: tx.id,
          hash: tx.hash,
          version: tx.version,
          flag: tx.flag,
          lockTime: tx.lockTime,
          blockHeight: block.height,
          indexInBlock: index,
          size: tx.size,
          weight: tx.weight
        })
        witnesses.push(...this.groupWitnesses(tx))
      }
      await this.#Transaction.bulkCreate(txs, {validate: false})
    }
    await this.#Witness.bulkCreate(witnesses, {validate: false})
    let ids = (await this.#Transaction.findAll({
      where: {id: {[$in]: newTransactions.map(tx => tx.id)}},
      attributes: ['_id'],
      order: [['_id', 'ASC']]
    })).map(tx => tx._id)
    for (let i = 0; i < newTransactions.length; ++i) {
      newTransactions[i]._id = ids[i]
    }
    return newTransactions
  }

  async processTxos(transactions) {
    let addressMap = new Map()
    let addressIds = []
    for (let index = 0; index < transactions.length; ++index) {
      addressIds.push([])
      let tx = transactions[index]
      for (let outputIndex = 0; outputIndex < tx.outputs.length; ++outputIndex) {
        addressIds[index].push(0)
        let address = Address.fromScript(tx.outputs[outputIndex].scriptPubKey, this.chain, tx.id, outputIndex)
        if (address) {
          let key = `${address.data.toString('hex')}/${address.type}`
          let addressItem = addressMap.get(key)
          if (addressItem) {
            addressItem.indices.push([index, outputIndex])
          } else {
            addressMap.set(key, {
              type: address.type,
              data: address.data,
              string: address.toString(),
              createHeight: tx.blockHeight,
              indices: [[index, outputIndex]]
            })
          }
        }
      }
    }
    let addressItems = []
    for (let {type, data} of addressMap.values()) {
      addressItems.push([this.#Address.parseType(type), data])
    }
    if (addressItems.length) {
      for (let {_id, type, data} of await this.#db.query(sql`
        SELECT _id, type, data FROM address
        WHERE (type, data) IN ${addressItems}
      `, {type: this.#db.QueryTypes.SELECT})) {
        let key = `${data.toString('hex')}/${this.#Address.getType(type)}`
        let item = addressMap.get(key)
        for (let [index, outputIndex] of item.indices) {
          addressIds[index][outputIndex] = _id
        }
        addressMap.delete(key)
      }
    }
    let newAddressItems = []
    for (let {type, data, string, createHeight} of addressMap.values()) {
      newAddressItems.push({type, data, string, createHeight})
    }

    for (let {_id, type, data} of await this.#Address.bulkCreate(newAddressItems, {validate: false})) {
      let key = `${data.toString('hex')}/${type}`
      let item = addressMap.get(key)
      for (let [index, outputIndex] of item.indices) {
        addressIds[index][outputIndex] = _id
      }
    }

    let outputTxos = []
    let inputTxos = []
    let mappings = []
    let mappingId = uuidv4().replace(/-/g, '')
    for (let index = 0; index < transactions.length; ++index) {
      let tx = transactions[index]
      for (let outputIndex = 0; outputIndex < tx.outputs.length; ++outputIndex) {
        let output = tx.outputs[outputIndex]
        outputTxos.push({
          transactionId: tx._id,
          outputIndex,
          scriptPubKey: output.scriptPubKey.toBuffer(),
          blockHeight: tx.blockHeight,
          value: output.value,
          addressId: addressIds[index][outputIndex],
          isStake: tx.indexInBlock === 0 || tx.blockHeight > this.chain.lastPoWBlockHeight && tx.indexInBlock === 1,
          inputId: 0,
          inputIndex: 0xffffffff
        })
      }
      for (let inputIndex = 0; inputIndex < tx.inputs.length; ++inputIndex) {
        let input = tx.inputs[inputIndex]
        if (Buffer.compare(tx.inputs[0].prevTxId, Buffer.alloc(32)) !== 0 || tx.inputs[0].outputIndex !== 0xffffffff) {
          mappings.push(sql`${[mappingId, tx.id, inputIndex, input.prevTxId, input.outputIndex]}`)
        }
        inputTxos.push({
          transactionId: tx._id,
          inputIndex,
          scriptSig: input.scriptSig,
          sequence: input.sequence,
          blockHeight: tx.blockHeight,
          value: 0n,
          addressId: '0',
          outputId: 0,
          outputIndex: 0xffffffff
        })
      }
    }

    await Promise.all([
      this.#TransactionOutput.bulkCreate(outputTxos, {validate: false}),
      this.#TransactionInput.bulkCreate(inputTxos, {validate: false}),
      ...mappings.length ? [
        this.#db.query(sql`
          INSERT INTO transaction_output_mapping (_id, input_transaction_id, input_index, output_transaction_id, output_index)
          VALUES ${{raw: mappings.join(', ')}}
        `)
      ] : []
    ])
    await this.#db.query(sql`
      UPDATE transaction_output output, transaction_input input, transaction_output_mapping mapping, transaction tx1, transaction tx2
      SET input.value = output.value, input.address_id = output.address_id,
        input.output_id = output.transaction_id, input.output_index = output.output_index,
        output.input_id = input.transaction_id, output.input_index = input.input_index, output.input_height = input.block_height
      WHERE tx1.id = mapping.input_transaction_id AND input.transaction_id = tx1._id AND input.input_index = mapping.input_index
        AND tx2.id = mapping.output_transaction_id AND output.transaction_id = tx2._id AND output.output_index = mapping.output_index
        AND mapping._id = ${mappingId}
    `)
    let t = await this.#db.transaction({isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_UNCOMMITTED})
    try {
      await this.#TransactionOutputMapping.destroy({where: {_id: mappingId}, transaction: t})
      await t.commit()
    } catch (err) {
      await t.rollback()
      throw err
    }
  }

  async processBalanceChanges({block, transactions}) {
    let filter
    if (transactions) {
      if (transactions.length === 0) {
        return
      }
      if (block) {
        await this.#db.query(sql`
          UPDATE balance_change balance, transaction tx
          SET balance.block_height = ${block.height}, balance.index_in_block = tx.index_in_block
          WHERE tx._id = balance.transaction_id AND tx.block_height = ${block.height}
        `)
      }
      filter = sql`transaction_id BETWEEN ${transactions[0]._id} and ${transactions[transactions.length - 1]._id}`
    } else {
      filter = sql`block_height = ${block.height}`
    }

    let t = await this.#db.transaction({isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_UNCOMMITTED})
    try {
      await this.#db.query(sql`
        INSERT INTO balance_change (transaction_id, block_height, index_in_block, address_id, value)
        SELECT
          tx._id AS transactionId,
          tx.block_height AS blockHeight,
          tx.index_in_block AS indexInBlock,
          list.address_id AS addressId,
          list.value AS value
        FROM (
          SELECT transaction_id, address_id, SUM(value) AS value
          FROM (
            SELECT transaction_id, address_id, value FROM transaction_output WHERE ${{raw: filter}}
            UNION ALL
            SELECT transaction_id, address_id, -value AS value FROM transaction_input WHERE ${{raw: filter}}
          ) AS block_balance
          GROUP BY transaction_id, address_id
        ) AS list
        LEFT JOIN transaction tx ON tx._id = list.transaction_id
      `)
      await t.commit()
    } catch (err) {
      await t.rollback()
      throw err
    }
  }

  async processReceipts(transactions) {
    let receipts = []
    for (let tx of transactions) {
      for (let outputIndex = 0; outputIndex < tx.outputs.length; ++outputIndex) {
        let output = tx.outputs[outputIndex]
        if ([
          OutputScript.EVM_CONTRACT_CREATE,
          OutputScript.EVM_CONTRACT_CREATE_SENDER,
          OutputScript.EVM_CONTRACT_CALL,
          OutputScript.EVM_CONTRACT_CALL_SENDER
        ].includes(output.scriptPubKey.type)) {
          let senderType
          let senderData
          let hasOpSender = [
            OutputScript.EVM_CONTRACT_CREATE_SENDER,
            OutputScript.EVM_CONTRACT_CALL_SENDER
          ].includes(output.scriptPubKey.type)
          if (hasOpSender) {
            senderType = this.#Address.getType(output.scriptPubKey.senderType)
            senderData = output.scriptPubKey.senderData
          } else {
            let {address: refunder} = await this.#TransactionInput.findOne({
              where: {transactionId: tx._id, inputIndex: 0},
              attributes: [],
              include: [{
                model: this.#Address,
                as: 'address',
                required: true,
                attributes: ['type', 'data']
              }]
            })
            senderType = refunder.type
            senderData = refunder.data
          }
          receipts.push({
            transactionId: tx._id,
            outputIndex,
            blockHeight: tx.blockHeight,
            indexInBlock: tx.indexInBlock,
            senderType,
            senderData,
            gasUsed: 0,
            contractAddress: Buffer.alloc(20),
            excepted: '',
            exceptedMessage: ''
          })
        }
      }
    }
    if (receipts.length) {
      await this.#EVMReceipt.bulkCreate(receipts, {validate: false})
    }
  }

  async _processContracts(block) {
    let transactionIds = (await this.#Transaction.findAll({
      where: {blockHeight: block.height},
      attributes: ['_id'],
      order: [['indexInBlock', 'ASC']]
    })).map(tx => tx._id)
    let contractSpends = []
    let receiptIndices = []
    let lastTransactionIndex = 0
    for (let i = 0; i < block.transactions.length; ++i) {
      let tx = block.transactions[i]
      if (Buffer.compare(tx.inputs[0].prevTxId, Buffer.alloc(32)) === 0 && tx.inputs[0].outputIndex === 0xffffffff) {
        continue
      }
      if (tx.inputs[0].scriptSig.length === 1 && tx.inputs[0].scriptSig[0] === Opcode.OP_SPEND) {
        contractSpends.push({sourceId: transactionIds[i], destId: transactionIds[lastTransactionIndex]})
      } else {
        lastTransactionIndex = i
        if (tx.outputs.some(output => [
          OutputScript.EVM_CONTRACT_CREATE,
          OutputScript.EVM_CONTRACT_CREATE_SENDER,
          OutputScript.EVM_CONTRACT_CALL,
          OutputScript.EVM_CONTRACT_CALL_SENDER
        ].includes(output.scriptPubKey.type))) {
          receiptIndices.push(i)
        }
      }
    }
    if (contractSpends.length) {
      await this.#ContractSpend.bulkCreate(contractSpends, {validate: false})
    }
    block.transactionsCount = block.transactions.length - (block.header.isProofOfStake() ? 2 : 1) - contractSpends.length
    block.contractTransactionsCount = receiptIndices.length
    if (receiptIndices.length === 0) {
      return
    }
    let gasRefunds = []
    let receipts = []
    let receiptLogs = []
    let client = this.node.getRpcClient()
    let blockReceipts = await Promise.all(
      await client.batch(() => {
        for (let index of receiptIndices) {
          client.gettransactionreceipt(block.transactions[index].id.toString('hex'))
        }
      })
    )
    block.receipts = [].concat(...blockReceipts).map(({contractAddress, log: logs}) => ({
      contractAddress: Buffer.from(contractAddress, 'hex'),
      logs: logs.map(({address, topics, data}) => ({
        address: Buffer.from(address, 'hex'),
        topics: topics.map(topic => Buffer.from(topic, 'hex')),
        data: Buffer.from(data, 'hex')
      }))
    }))
    let refundTxos = await this.#TransactionOutput.findAll({
      where: {outputIndex: {[$gt]: block.header.isProofOfStake() ? 1 : 0}},
      attributes: ['outputIndex', 'value', 'addressId'],
      include: {
        model: this.#Transaction,
        as: 'transaction',
        required: true,
        where: {id: block.transactions[block.header.isProofOfStake() ? 1 : 0].id},
        attributes: []
      }
    })
    let refunderMap = new Map((await this.#TransactionInput.findAll({
      where: {inputIndex: 0},
      attributes: [],
      include: [
        {
          model: this.#Transaction,
          as: 'transaction',
          required: true,
          where: {id: {[$in]: receiptIndices.map(index => block.transactions[index].id)}},
          attributes: ['id']
        },
        {
          model: this.#Address,
          as: 'address',
          required: true,
          attributes: ['_id', 'type', 'data']
        }
      ]
    })).map(item => [item.transaction.id.toString('hex'), {_id: item.address._id, type: item.address.type, data: item.address.data}]))
    let receiptIndex = -1
    for (let index = 0; index < receiptIndices.length; ++index) {
      let indexInBlock = receiptIndices[index]
      let tx = block.transactions[indexInBlock]
      let indices = []
      for (let i = 0; i < tx.outputs.length; ++i) {
        if ([
          OutputScript.EVM_CONTRACT_CREATE,
          OutputScript.EVM_CONTRACT_CREATE_SENDER,
          OutputScript.EVM_CONTRACT_CALL,
          OutputScript.EVM_CONTRACT_CALL_SENDER
        ].includes(tx.outputs[i].scriptPubKey.type)) {
          indices.push(i)
        }
      }
      for (let i = 0; i < indices.length; ++i) {
        let output = tx.outputs[indices[i]]
        let refunder = refunderMap.get(tx.id.toString('hex'))
        let {gasUsed, contractAddress, excepted, exceptedMessage, log: logs} = blockReceipts[index][i]
        if (gasUsed) {
          let {gasLimit, gasPrice} = output.scriptPubKey
          let refundValue = BigInt(gasPrice * (gasLimit - gasUsed))
          if (refundValue) {
            let txoIndex = refundTxos.findIndex(txo => txo.value === refundValue && txo.addressId === refunder._id)
            if (txoIndex === -1) {
              this.logger.error(`Contract Service: cannot find refund output: ${tx.id.toString('hex')}`)
            } else {
              gasRefunds.push({
                transactionId: transactionIds[indexInBlock],
                outputIndex: indices[i],
                refundId: transactionIds[block.header.isProofOfStake() ? 1 : 0],
                refundIndex: refundTxos[txoIndex].outputIndex
              })
              refundTxos.splice(txoIndex, 1)
            }
          }
        }
        ++receiptIndex
        receipts.push({
          transactionId: transactionIds[indexInBlock],
          outputIndex: indices[i],
          indexInBlock,
          gasUsed,
          contractAddress: Buffer.from(contractAddress, 'hex'),
          excepted,
          exceptedMessage: exceptedMessage || ''
        })
        for (let j = 0; j < logs.length; ++j) {
          let {address, topics, data} = logs[j]
          receiptLogs.push({
            receiptId: receiptIndex,
            logIndex: j,
            blockHeight: block.height,
            address: Buffer.from(address, 'hex'),
            topic1: topics[0] && Buffer.from(topics[0], 'hex'),
            topic2: topics[1] && Buffer.from(topics[1], 'hex'),
            topic3: topics[2] && Buffer.from(topics[2], 'hex'),
            topic4: topics[3] && Buffer.from(topics[3], 'hex'),
            data: Buffer.from(data, 'hex')
          })
        }
      }
    }
    await Promise.all([
      this.#GasRefund.bulkCreate(gasRefunds, {validate: false}),
      this.#EVMReceiptMapping.bulkCreate(receipts, {validate: false})
    ])
    await this.#db.query(sql`
      UPDATE evm_receipt receipt, evm_receipt_mapping mapping
      SET receipt.block_height = ${block.height}, receipt.index_in_block = mapping.index_in_block,
        receipt.gas_used = mapping.gas_used, receipt.contract_address = mapping.contract_address,
        receipt.excepted = mapping.excepted, receipt.excepted_message = mapping.excepted_message
      WHERE receipt.transaction_id = mapping.transaction_id AND receipt.output_index = mapping.output_index
    `)
    await this.#EVMReceiptMapping.destroy({truncate: true})
    let receiptIds = (await this.#EVMReceipt.findAll({
      where: {blockHeight: block.height},
      attributes: ['_id'],
      order: [['indexInBlock', 'ASC'], ['transactionId', 'ASC'], ['outputIndex', 'ASC']]
    })).map(receipt => receipt._id)
    for (let log of receiptLogs) {
      log.receiptId = receiptIds[log.receiptId]
    }
    await this.#EVMReceiptLog.bulkCreate(receiptLogs, {validate: false})
  }

  async removeReplacedTransactions(tx) {
    let prevTxs = await this.#Transaction.findAll({
      where: {id: {[$in]: tx.inputs.map(input => input.prevTxId)}},
      attributes: ['_id', 'id']
    })
    let inputTxos = []
    for (let input of tx.inputs) {
      let item = prevTxs.find(tx => Buffer.compare(tx.id, input.prevTxId) === 0)
      if (!item) {
        return false
      }
      inputTxos.push([item._id, input.outputIndex])
    }
    let transactionsToRemove = (await this.#db.query(sql`
      SELECT DISTINCT(input_id) AS id FROM transaction_output
      WHERE (transaction_id, output_index) IN ${inputTxos} AND input_id > 0
    `, {type: this.#db.QueryTypes.SELECT})).map(tx => tx.id)
    for (let id of transactionsToRemove) {
      await this._removeMempoolTransaction(id)
    }
  }

  async _removeMempoolTransaction(id) {
    let transactionsToRemove = (await this.#TransactionOutput.findAll({
      where: {transactionId: id},
      attributes: ['inputId']
    })).map(tx => tx.inputId)
    for (let subId of transactionsToRemove) {
      await this._removeMempoolTransaction(subId)
    }
    await this.#db.query(sql`
      UPDATE transaction_output output, transaction_input input
      SET output.input_id = 0, output.input_index = 0xffffffff
      WHERE input.transaction_id = ${id} AND output.transaction_id = input.output_id AND output.output_index = input.output_index
    `)
    await Promise.all([
      this.#TransactionOutput.destroy({where: {transactionId: id}}),
      this.#TransactionInput.destroy({where: {transactionId: id}}),
      this.#BalanceChange.destroy({where: {transactionId: id}})
    ])
    await this.#db.query(sql`
      DELETE tx, witness FROM transaction tx
      LEFT JOIN witness ON witness.transaction_id = tx.id
      WHERE tx._id = ${id}
    `)
  }

  groupWitnesses(tx) {
    let witnesses = []
    for (let i = 0; i < tx.inputs.length; ++i) {
      for (let j = 0; j < tx.inputs[i].witness.length; ++j) {
        witnesses.push({
          transactionId: tx.id,
          inputIndex: i,
          witnessIndex: j,
          script: tx.inputs[i].witness[j]
        })
      }
    }
    return witnesses
  }
}

module.exports = TransactionService
