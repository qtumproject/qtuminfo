import {Transaction, Address} from 'qtuminfo-lib'

export default class TransactionsController {
  constructor(node) {
    this.node = node
  }

  async transaction(ctx, next) {
    let id = ctx.params.id
    let brief = 'brief' in ctx.query
    if (!/^[0-9a-f]{64}$/.test(id)) {
      ctx.throw(404)
    }
    let transaction = await this.node.getTransaction(Buffer.from(id, 'hex'))
    if (transaction) {
      ctx.state.transaction = await this._transformTransaction(transaction, {brief})
      await next()
    } else {
      ctx.throw(404)
    }
  }

  async transactions(ctx, next) {
    let ids = ctx.params.ids.split(',')
    let brief = 'brief' in ctx.query
    if (ids.some(id => !/^[0-9a-f]{64}$/.test(id))) {
      ctx.throw(404)
    }
    let list = []
    for (let id of ids) {
      let transaction = await this.node.getTransaction(Buffer.from(id, 'hex'))
      if (transaction) {
        list.push(transaction)
      } else {
        ctx.throw(404)
      }
    }
    ctx.state.transactions = await Promise.all(list.map(transaction => this._transformTransaction(transaction, {brief})))
    await next()
  }

  async show(ctx) {
    if (ctx.state.transaction) {
      ctx.body = ctx.state.transaction
    } else if (ctx.state.transactions) {
      ctx.body = ctx.state.transactions
    }
  }

  async rawTransaction(ctx) {
    let id = ctx.params.id
    if (!/^[0-9a-f]{64}$/.test(id)) {
      ctx.throw(404)
    }
    let transaction = await this.node.getRawTransaction(Buffer.from(id, 'hex'))
    if (transaction) {
      ctx.body = transaction.toBuffer().toString('hex')
    } else {
      ctx.throw(404)
    }
  }

  async recentTransactions(ctx) {
    let transactions = await this.node.getRecentTransactions()
    ctx.body = await Promise.all(transactions.map(transaction => this._transformTransaction(transaction, {brief: true})))
  }

  async send(ctx) {
    let data = ctx.request.body
    if (!/^([0-9a-f][0-9a-f])+$/.test(data)) {
      ctx.throw(400)
    }
    let id = await this.node.sendRawTransaction(Buffer.from(data, 'hex'))
    ctx.body = id.toString('hex')
  }

  async _transformTransaction(transaction, {brief = false} = {}) {
    let confirmations = 'block' in transaction ? this.node.getBlockTip().height - transaction.block.height + 1 : 0
    let inputValue = transaction.inputs.map(input => input.value).reduce((x, y) => x + y)
    let outputValue = transaction.outputs.map(output => output.value).reduce((x, y) => x + y)
    let transformed = {
      id: transaction.id.toString('hex'),
      ...brief
        ? {}
        : {
          hash: transaction.hash.toString('hex'),
          version: transaction.version,
          witnesses: transaction.witnesses.map(witness => witness.map(item => item.toString('hex'))),
          lockTime: transaction.lockTime,
          blockHash: transaction.block && transaction.block.hash.toString('hex')
        },
      blockHeight: transaction.block && transaction.block.height,
      confirmations,
      timestamp: transaction.block && transaction.block.timestamp,
      inputs: [],
      outputs: [],
      isCoinbase: Transaction.prototype.isCoinbase.call(transaction),
      isCoinstake: Transaction.prototype.isCoinstake.call(transaction),
      inputValue: inputValue.toString(),
      outputValue: outputValue.toString(),
      fees: (inputValue - outputValue).toString(),
      ...brief
        ? {}
        : {
          size: transaction.size,
          receipts: transaction.receipts.map(({gasUsed, contractAddress, excepted, logs}) => ({
            gasUsed,
            contractAddress: contractAddress.toString('hex'),
            excepted,
            logs: logs.map(({address, topics, data}) => ({
              address: address.toString('hex'),
              topics: topics.map(topic => topic.toString('hex')),
              data: data.toString('hex')
            }))
          }))
        }
    }

    let invalidContracts = {}
    if (transformed.isCoinbase) {
      transformed.inputs.push({
        coinbase: transaction.inputs[0].scriptSig.toBuffer().toString('hex'),
        ...brief
          ? {}
          : {
            sequence: transaction.inputs[0].sequence,
            index: 0
          }
      })
    } else {
      for (let index = 0; index < transaction.inputs.length; ++index) {
        let input = transaction.inputs[index]
        let transformedInput = {
          prevTxId: input.prevTxId.toString('hex'),
          outputIndex: input.outputIndex,
          value: input.value.toString(),
          address: input.address && input.address.toString()
        }
        if (!brief) {
          transformedInput.sequence = input.sequence
          transformedInput.index = index
          transformedInput.scriptSig = {
            hex: input.scriptSig.toBuffer().toString('hex'),
            asm: input.scriptSig.toString()
          }
        }
        if (input.address && input.address.type === Address.EVM_CONTRACT) {
          if (transformedInput.address in invalidContracts) {
            if (invalidContracts[transformedInput.address]) {
              transformedInput.isInvalidContract = true
            }
          } else {
            invalidContracts[transformedInput.address] = !await this.node.getContract(input.address.data)
            transformedInput.isInvalidContract = invalidContracts[transformedInput.address]
          }
        }
        transformed.inputs.push(transformedInput)
      }
    }
    for (let index = 0; index < transaction.outputs.length; ++index) {
      let output = transaction.outputs[index]
      let type
      let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, index)
      if (address) {
        type = address.type
      } else if (output.scriptPubKey.isDataOut()) {
        type = 'nulldata'
      } else {
        type = 'nonstandard'
      }
      let transformedOutput = {
        value: output.value.toString(),
        address: output.address && output.address.toString(),
        index,
        scriptPubKey: {type}
      }
      if (!brief) {
        transformedOutput.scriptPubKey.hex = output.scriptPubKey.toBuffer().toString('hex')
        transformedOutput.scriptPubKey.asm = output.scriptPubKey.toString()
      }
      if (output.spentTxId) {
        transformedOutput.spentTxId = output.spentTxId.toString('hex')
        transformedOutput.spentIndex = output.spentIndex
      }
      if (address && [Address.EVM_CONTRACT_CREATE, Address.EVM_CONTRACT_CALL].includes(address.type)) {
        if (transformedOutput.address in invalidContracts) {
          transformedOutput.isInvalidContract = invalidContracts[transformedOutput.address]
        } else {
          invalidContracts[transformedOutput.address] = !await this.node.getContract(address.data)
          transformedOutput.isInvalidContract = invalidContracts[transformedOutput.address]
        }
      }
      transformed.outputs.push(transformedOutput)
    }

    let qrc20TokenTransfers = await this.node.getQRC20TokenTransfers(transaction)
    transformed.qrc20TokenTransfers = qrc20TokenTransfers.map(({token, from, to, amount}) => ({
      token: {
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString(),
        version: token.version
      },
      from: from && from.toString(),
      to: to && to.toString(),
      amount: amount.toString()
    }))
    let qrc721TokenTransfers = await this.node.getQRC721TokenTransfers(transaction)
    transformed.qrc721TokenTransfers = qrc721TokenTransfers.map(({token, from, to, tokenId}) => ({
      token: {
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString()
      },
      from: from && from.toString(),
      to: to && to.toString(),
      tokenId: tokenId.toString('hex')
    }))

    return transformed
  }
}
