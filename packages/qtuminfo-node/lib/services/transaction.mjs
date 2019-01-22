import assert from 'assert'
import Sequelize from 'sequelize'
import {Address} from 'qtuminfo-lib'
import Service from './base'

const {gt: $gt, in: $in} = Sequelize.Op

export default class TransactionService extends Service {
  constructor(options) {
    super(options)
    this._tip = null
    this._synced = false
  }

  static get dependencies() {
    return ['block', 'db']
  }

  async start() {
    this.db = this.node.getDatabase()
    this.Address = this.node.getModel('address')
    this.Transaction = this.node.getModel('transaction')
    this.Witness = this.node.getModel('witness')
    this.TransactionOutput = this.node.getModel('transaction_output')
    this.BalanceChange = this.node.getModel('balance_change')
    this.GasRefund = this.node.getModel('gas_refund')
    this.ContractSpend = this.node.getModel('contract_spend')
    this.Receipt = this.node.getModel('receipt')
    this.ReceiptLog = this.node.getModel('receipt_log')
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
    }
    await this.TransactionOutput.destroy({
      where: {
        outputTxId: null,
        inputHeight: {[$gt]: this._tip.height}
      }
    })
    await this.TransactionOutput.update(
      {inputTxId: null, inputIndex: null, scriptSig: null, sequence: null, inputHeight: null},
      {where: {inputHeight: {[$gt]: this._tip.height}}}
    )
    await this.db.query(`
      DELETE tx, witness, txo, receipt, log, refund, contract_spend, balance
      FROM transaction tx
      LEFT JOIN witness ON witness.transaction_id = tx.id
      LEFT JOIN transaction_output txo ON txo.output_transaction_id = tx.id
      LEFT JOIN receipt ON receipt.transaction_id = tx.id
      LEFT JOIN receipt_log log ON log.receipt_id = receipt._id
      LEFT JOIN gas_refund refund ON refund.transaction_id = tx.id
      LEFT JOIN contract_spend ON contract_spend.source_id = tx.id
      LEFT JOIN balance_change balance ON balance.transaction_id = tx._id
      WHERE tx.block_height > ${this._tip.height}
    `)
    await this.Address.destroy({where: {createHeight: {[$gt]: this._tip.height}}})
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onReorg(height) {
    await this.db.query(`
      UPDATE transaction tx, transaction_output txo
      SET txo.input_transaction_id = NULL, txo.input_index = NULL,
        txo.scriptsig = NULL, txo.sequence = NULL, txo.input_height = NULL
      WHERE tx.id = txo.input_transaction_id AND tx.block_height > ${Math.max(height, 5000)} AND tx.index_in_block = 1
    `)
    await this.db.query(`
      DELETE receipt, log, refund, contract_spend
      FROM transaction tx
      LEFT JOIN receipt ON receipt.transaction_id = tx.id
      LEFT JOIN receipt_log log ON log.receipt_id = receipt._id
      LEFT JOIN gas_refund refund ON refund.transaction_id = tx.id
      LEFT JOIN contract_spend ON contract_spend.source_id = tx.id
      WHERE tx.block_height > ${height}
    `)
    await this.db.query(`
      DELETE tx, witness, txo, balance
      FROM transaction tx
      LEFT JOIN witness ON witness.transaction_id = tx.id
      LEFT JOIN transaction_output txo ON txo.output_transaction_id = tx.id OR txo.input_transaction_id = tx.id
      LEFT JOIN balance_change balance ON balance.transaction_id = tx._id
      WHERE tx.block_height > ${height} AND tx.index_in_block < 2
        AND (tx.index_in_block = 0 OR tx.block_height > 5000)
    `)
    await this.Transaction.update(
      {blockHeight: 0xffffffff, indexInBlock: 0xffffffff},
      {where: {blockHeight: {[$gt]: height}}}
    )
    await this.TransactionOutput.update({outputHeight: 0xffffffff}, {where: {outputHeight: {[$gt]: height}}})
    await this.TransactionOutput.update({inputHeight: 0xffffffff}, {where: {inputHeight: {[$gt]: height}}})
    await this.Address.update({createHeight: 0xffffffff}, {where: {createHeight: {[$gt]: height}}})
  }

  async onBlock(block) {
    if (this.node.stopping) {
      return
    }
    try {
      let newTransactions = await this._processBlock(block)
      await this.processOutputs(newTransactions, block)
      await this.processInputs(newTransactions, block)
      if (this._synced) {
        await this.processBalanceChanges({transactions: newTransactions})
      } else {
        await this.processBalanceChanges({block})
      }
      await this._processContracts(block)
      this._tip.height = block.height
      this._tip.hash = block.hash
      await this.node.updateServiceTip(this.name, this._tip)
    } catch (err) {
      this.logger.error(err)
      this.node.stop()
    }
  }

  async onSynced() {
    this._synced = true
  }

  async _processBlock(block) {
    let newTransactions = []
    let txs = []
    let witnesses = []
    if (this._synced) {
      let mempoolTransactions = await this.Transaction.findAll({
        where: {id: {[$in]: block.transactions.slice(block.height > 5000 ? 2 : 1).map(tx => tx.id)}},
        attributes: ['id']
      })
      let mempoolTransactionsSet = new Set()
      if (mempoolTransactions.length) {
        let ids = mempoolTransactions.map(tx => tx.id)
        let hexIds = ids.map(id => `0x${id.toString('hex')}`)
        mempoolTransactionsSet = new Set(ids.map(id => id.toString('hex')))
        await this.TransactionOutput.update(
          {outputHeight: block.height},
          {where: {outputTxId: {[$in]: ids}}}
        )
        await this.TransactionOutput.update(
          {inputHeight: block.height},
          {where: {inputTxId: {[$in]: ids}}}
        )
        await this.db.query(`
          UPDATE address, transaction_output txo
          SET address.create_height = LEAST(address.create_height, ${block.height})
          WHERE address._id = txo.address_id AND txo.output_transaction_id IN (${hexIds.join(', ')})
        `)
      }

      for (let index = 0; index < block.transactions.length; ++index) {
        let tx = block.transactions[index]
        txs.push({
          id: tx.id,
          hash: tx.hash,
          version: tx.version,
          marker: tx.marker || 0,
          flag: Boolean(tx.flag),
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
        for (let i = 0; i < tx.witnesses.length; ++i) {
          for (let j = 0; j < tx.witnesses[i].length; ++j) {
            witnesses.push({
              transactionId: tx.id,
              inputIndex: i,
              witnessIndex: j,
              script: tx.witnesses[i][j]
            })
          }
        }
      }
    } else {
      for (let index = 0; index < block.transactions.length; ++index) {
        let tx = block.transactions[index]
        newTransactions.push(tx)
        txs.push({
          id: tx.id,
          hash: tx.hash,
          version: tx.version,
          marker: tx.marker || 0,
          flag: Boolean(tx.flag),
          lockTime: tx.lockTime,
          blockHeight: block.height,
          indexInBlock: index,
          size: tx.size,
          weight: tx.weight
        })
        for (let i = 0; i < tx.witnesses.length; ++i) {
          for (let j = 0; j < tx.witnesses[i].length; ++j) {
            witnesses.push({
              transactionId: tx.id,
              inputIndex: i,
              witnessIndex: j,
              script: tx.witnesses[i][j]
            })
          }
        }
      }
    }
    await this.Transaction.bulkCreate(txs, {
      updateOnDuplicate: ['blockHeight', 'indexInBlock'],
      validate: false
    })
    await this.Witness.bulkCreate(witnesses, {validate: false})
    return newTransactions
  }

  async processOutputs(transactions, block) {
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
            addressItem.indexes.push([index, outputIndex])
          } else {
            addressMap.set(key, {
              type: address.type,
              data: address.data,
              string: address.toString(),
              createHeight: block.height,
              indexes: [[index, outputIndex]]
            })
          }
        }
      }
    }
    let addressItems = []
    for (let {type, data} of addressMap.values()) {
      addressItems.push(`('${type}', 0x${data.toString('hex')})`)
    }
    if (addressItems.length) {
      for (let {_id, type, data} of await this.db.query(`
        SELECT _id, type, data FROM address
        WHERE (type, data) IN (${addressItems.join(', ')})
      `, {type: this.db.QueryTypes.SELECT})) {
        let key = `${data.toString('hex')}/${type}`
        let item = addressMap.get(key)
        for (let [index, outputIndex] of item.indexes) {
          addressIds[index][outputIndex] = _id
        }
        addressMap.delete(key)
      }
    }
    let newAddressItems = []
    for (let {type, data, string, createHeight} of addressMap.values()) {
      newAddressItems.push({type, data, string, createHeight})
    }

    for (let {_id, type, data} of await this.Address.bulkCreate(newAddressItems, {validate: false})) {
      let key = `${data.toString('hex')}/${type}`
      let item = addressMap.get(key)
      for (let [index, outputIndex] of item.indexes) {
        addressIds[index][outputIndex] = _id
      }
    }

    let outputTxos = []
    for (let index = 0; index < transactions.length; ++index) {
      let tx = transactions[index]
      for (let outputIndex = 0; outputIndex < tx.outputs.length; ++outputIndex) {
        let output = tx.outputs[outputIndex]
        outputTxos.push({
          outputTxId: tx.id,
          outputIndex,
          scriptPubKey: output.scriptPubKey.toBuffer(),
          outputHeight: block.height,
          value: output.value,
          addressId: addressIds[index][outputIndex]
        })
      }
    }
    await this.TransactionOutput.bulkCreate(outputTxos, {validate: false})
  }

  async processInputs(transactions, block) {
    let inputTxos = []
    for (let tx of transactions) {
      for (let index = 0; index < tx.inputs.length; ++index) {
        let input = tx.inputs[index]
        inputTxos.push({
          ...input.scriptSig.isCoinbase() ? {} : {
            outputTxId: input.prevTxId,
            outputIndex: input.outputIndex
          },
          inputTxId: tx.id,
          inputIndex: index,
          scriptSig: input.scriptSig.toBuffer(),
          sequence: input.sequence,
          inputHeight: block.height,
          value: 0n,
          addressId: '0'
        })
      }
    }
    await this.TransactionOutput.bulkCreate(inputTxos, {
      updateOnDuplicate: ['inputTxId', 'inputIndex', 'scriptSig', 'sequence', 'inputHeight'],
      validate: false
    })
  }

  async processBalanceChanges({block, transactions}) {
    let filters
    if (block) {
      filters = [
        `output_height = ${block.height}`,
        `input_height = ${block.height}`
      ]
    } else {
      if (transactions.length === 0) {
        return
      }
      let ids = transactions.map(tx => `0x${tx.id.toString('hex')}`).join(', ')
      filters = [
        `output_transaction_id IN (${ids})`,
        `input_transaction_id IN (${ids})`
      ]
    }
    await this.db.query(`
      INSERT INTO balance_change (transaction_id, address_id, value)
      SELECT
        tx._id AS transaction_id,
        block_balance.address_id AS address_id,
        SUM(block_balance.value) AS value
      FROM (
        SELECT output_transaction_id AS transaction_id, address_id, value
        FROM transaction_output
        WHERE ${filters[0]}
        UNION ALL
        SELECT input_transaction_id AS transaction_id, address_id, -value AS value
        FROM transaction_output
        WHERE ${filters[1]}
      ) AS block_balance
      LEFT JOIN transaction tx ON tx.id = block_balance.transaction_id
      GROUP BY tx._id, block_balance.address_id
    `)
  }

  async _processContracts(block) {
    let contractSpends = []
    let receiptIndices = []
    let lastTransactionIndex = 0
    for (let i = 0; i < block.transactions.length; ++i) {
      let tx = block.transactions[i]
      if (tx.inputs[0].scriptSig.isContractSpend()) {
        contractSpends.push({sourceTxId: tx.id, destTxId: block.transactions[lastTransactionIndex].id})
      } else {
        lastTransactionIndex = i
        if (tx.outputs.some(
          output => output.scriptPubKey.isEVMContractCreate() || output.scriptPubKey.isEVMContractCall()
        )) {
          receiptIndices.push(i)
        }
      }
    }
    if (contractSpends.length) {
      await this.ContractSpend.bulkCreate(contractSpends, {validate: false})
    }
    block.transactionsCount = block.transactions.length - (block.height > 5000 ? 2 : 1) - contractSpends.length
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
    let refundTxos = await this.TransactionOutput.findAll({
      where: {
        outputTxId: block.transactions[block.header.isProofOfStake() ? 1 : 0].id,
        outputIndex: {[$gt]: 0}
      },
      attributes: ['outputIndex', 'value', 'addressId']
    })
    let senderMap = new Map((await this.TransactionOutput.findAll({
      where: {
        inputTxId: {[$in]: receiptIndices.map(index => block.transactions[index].id)},
        inputIndex: 0
      },
      attributes: ['inputTxId', 'addressId']
    })).map(item => [item.inputTxId.toString('hex'), item.addressId]))
    let receiptIndex = -1
    for (let index = 0; index < receiptIndices.length; ++index) {
      let tx = block.transactions[receiptIndices[index]]
      let indices = []
      for (let i = 0; i < tx.outputs.length; ++i) {
        if (tx.outputs[i].scriptPubKey.isEVMContractCreate() || tx.outputs[i].scriptPubKey.isEVMContractCall()) {
          indices.push(i)
        }
      }
      for (let i = 0; i < indices.length; ++i) {
        let output = tx.outputs[indices[i]]
        let {gasUsed, contractAddress, excepted, log: logs} = blockReceipts[index][i]
        if (excepted !== 'Unknown') {
          let gasLimit = BigInt(`0x${Buffer.from(output.scriptPubKey.chunks[1].buffer, 'hex')
            .reverse()
            .toString('hex')
          }`)
          let gasPrice = BigInt(`0x${Buffer.from(output.scriptPubKey.chunks[2].buffer, 'hex')
            .reverse()
            .toString('hex')
          }`)
          let refundValue = gasPrice * (gasLimit - BigInt(gasUsed))
          if (refundValue) {
            let sender = senderMap.get(tx.id.toString('hex'))
            let txoIndex = refundTxos.findIndex(txo => txo.value === refundValue && txo.addressId === sender)
            if (txoIndex === -1) {
              this.logger.error(`Contract Service: cannot find refund output: ${tx.id.toString('hex')}`)
            } else {
              gasRefunds.push({
                transactionId: tx.id,
                outputIndex: indices[i],
                refundTxId: block.transactions[block.header.isProofOfStake() ? 1 : 0].id,
                refundIndex: refundTxos[txoIndex].outputIndex
              })
              refundTxos.splice(txoIndex, 1)
            }
          }
        }
        ++receiptIndex
        receipts.push({
          transactionId: tx.id,
          outputIndex: indices[i],
          gasUsed,
          contractAddress: Buffer.from(contractAddress, 'hex'),
          excepted
        })
        for (let j = 0; j < logs.length; ++j) {
          let {address, topics, data} = logs[j]
          receiptLogs.push({
            receiptId: receiptIndex,
            logIndex: j,
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
    await this.GasRefund.bulkCreate(gasRefunds, {validate: false})
    let newReceipts = await this.Receipt.bulkCreate(receipts, {validate: false})
    for (let log of receiptLogs) {
      log.receiptId = newReceipts[log.receiptId]._id
    }
    await this.ReceiptLog.bulkCreate(receiptLogs, {validate: false})
  }

  async removeReplacedTransactions(tx) {
    let inputTxos = tx.inputs.map(input => `(0x${input.prevTxId.toString('hex')}, ${input.outputIndex})`)
    let transactionsToRemove = (await this.db.query(`
      SELECT DISTINCT(input_transaction_id) AS transactionId FROM transaction_output
      WHERE (output_transaction_id, output_index) IN (${inputTxos.join(', ')}) AND input_transaction_id IS NOT NULL
    `, {type: this.db.QueryTypes.SELECT})).map(tx => tx.transactionId)
    for (let id of transactionsToRemove) {
      assert(Buffer.compare(id, tx.id) !== 0)
      await this._removeMempoolTransaction(id)
    }
  }

  async _removeMempoolTransaction(id) {
    let transactionsToRemove = (await this.TransactionOutput.findAll({
      where: {outputTxId: id},
      attributes: ['inputTxId']
    })).map(tx => tx.inputTxId)
    for (let subId of transactionsToRemove) {
      assert(Buffer.compare(subId, id) !== 0)
      await this._removeMempoolTransaction(subId)
    }
    await this.TransactionOutput.update(
      {inputTxId: null, inputIndex: null, scriptSig: null, sequence: null, inputHeight: null},
      {where: {inputTxId: id}}
    )
    await this.db.query(`
      DELETE tx, witness, txo, input, balance
      FROM transaction tx
      LEFT JOIN witness ON witness.transaction_id = tx.id
      LEFT JOIN transaction_output txo ON txo.output_transaction_id = tx.id
      LEFT JOIN balance_change balance ON balance.transaction_id = tx._id
      WHERE tx.id = 0x${id.toString('hex')}
    `)
  }
}
