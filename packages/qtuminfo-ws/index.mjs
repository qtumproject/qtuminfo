import WebSocket from 'ws'
import {Transaction, Address} from 'qtuminfo-lib'
import Service from 'qtuminfo-node/lib/services/base'

export default class QtuminfoWebsocketService extends Service {
  constructor(options) {
    super(options)
    this._options = options
  }

  static get dependencies() {
    return ['block', 'header', 'web']
  }

  get routePrefix() {
    return this._routePrefix
  }

  async start() {
    this._bus = this.node.openBus({remoteAddress: 'localhost-qtuminfo-ws'})
    this._bus.on('mempool/transaction', this._mempoolTransactionEventHandler.bind(this))
    this._bus.subscribe('mempool/transaction')
    this._bus.on('block/block', this._blockEventHandler.bind(this))
    this._bus.subscribe('block/block')
    this._bus.on('block/transaction', this._transactionEventHandler.bind(this))
    this._bus.subscribe('block/transaction')
    // this._bus.on('block/address', this._addressEventHandler.bind(this))
    // this._bus.subscribe('block/address')

    this._server = new WebSocket.Server({port: this._options.port})
    this._server.on('connection', ws => {
      ws.subscriptions = new Set(['height'])
      ws.send(JSON.stringify({
        type: 'height',
        data: this.node.getBlockTip().height
      }))
      ws.on('message', message => {
        try {
          if (message === 'ping') {
            ws.send(JSON.stringify('pong'))
          } else {
            message = JSON.parse(message)
            if (message.type === 'subscribe') {
              ws.subscriptions.add(message.data)
            } else if (message.type === 'unsubscribe') {
              ws.subscriptions.delete(message.data)
            }
          }
        } catch (err) {}
      })
      ws.on('close', () => {})
      ws.on('error', () => {})
    })
  }

  async stop() {
    this._server.close()
  }

  getRemoteAddress(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress
  }

  async _mempoolTransactionEventHandler(transaction) {
    transaction = await this._transformTransaction(transaction)
    for (let client of this._server.clients) {
      if (client.subscriptions.has('mempool/transaction')) {
        client.send(JSON.stringify({
          type: 'mempool/transaction',
          data: transaction
        }))
      }
    }
  }

  async _blockEventHandler(block) {
    block = await this._transformBlock(block)
    for (let client of this._server.clients) {
      if (client.subscriptions.has('height')) {
        client.send(JSON.stringify({
          type: 'height',
          data: block.height
        }))
      }
      if (client.subscriptions.has('block')) {
        client.send(JSON.stringify({
          type: 'block',
          data: block
        }))
      }
    }
  }

  async _transactionEventHandler(transaction) {
    transaction = await this._transformTransaction(transaction)
    for (let client of this._server.clients) {
      if (client.subscriptions.has(`transaction/${transaction.id}`)) {
        client.send(JSON.stringify({
          type: `transaction/${transaction.id}`,
          data: transaction
        }))
      }
    }
  }

  async _transformBlock(block) {
    let reward = await this.node.getBlockReward(block.height, block.isProofOfStake)
    let duration
    if (block.height !== 0) {
      duration = block.timestamp - (await this.node.getBlockHeader(block.prevHash)).timestamp
    }
    return {
      hash: block.hash.toString('hex'),
      height: block.height,
      version: block.version,
      prevHash: block.prevHash.toString('hex'),
      nextHash: block.nextHash && block.nextHash.toString('hex'),
      merkleRoot: block.merkleRoot.toString('hex'),
      timestamp: block.timestamp,
      bits: block.bits,
      nonce: block.nonce,
      hashStateRoot: block.hashStateRoot.toString('hex'),
      hashUTXORoot: block.hashUTXORoot.toString('hex'),
      prevOutStakeHash: block.prevOutStakeHash.toString('hex'),
      prevOutStakeN: block.prevOutStakeN,
      signature: block.signature.toString('hex'),
      chainwork: block.chainwork.toString(16).padStart(64, '0'),
      size: block.size,
      weight: block.weight,
      transactions: block.transactions.map(id => id.toString('hex')),
      miner: block.miner.toString(),
      coinstakeValue: block.coinstakeValue && block.coinstakeValue.toString(),
      difficulty: block.difficulty,
      reward: reward.toString(),
      duration,
      confirmations: this.node.getBlockTip().height - block.height + 1
    }
  }

  async _transformTransaction(transaction) {
    let confirmations = 'block' in transaction ? this.node.getBlockTip().height - transaction.block.height + 1 : 0
    let inputValue = transaction.inputs.map(input => input.value).reduce((x, y) => x + y)
    let outputValue = transaction.outputs.map(output => output.value).reduce((x, y) => x + y)
    let transformed = {
      id: transaction.id.toString('hex'),
      hash: transaction.hash.toString('hex'),
      version: transaction.version,
      witnesses: transaction.witnesses.map(witness => witness.map(item => item.toString('hex'))),
      lockTime: transaction.lockTime,
      blockHash: transaction.block && transaction.block.hash.toString('hex'),
      blockHeight: transaction.block && transaction.block.height,
      confirmations,
      timestamp: transaction.block && transaction.block.timestamp,
      isCoinbase: Transaction.prototype.isCoinbase.call(transaction),
      isCoinstake: Transaction.prototype.isCoinstake.call(transaction),
      inputValue: inputValue.toString(),
      outputValue: outputValue.toString(),
      fees: (inputValue - outputValue).toString(),
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
    if (transformed.isCoinbase) {
      transformed.inputs = [{
        coinbase: transaction.inputs[0].scriptSig.toBuffer().toString('hex'),
        sequence: transaction.inputs[0].sequence,
        index: 0
      }]
    } else {
      transformed.inputs = transaction.inputs.map((input, index) => ({
        prevTxId: input.prevTxId.toString('hex'),
        outputIndex: input.outputIndex,
        sequence: input.sequence,
        index,
        value: input.value.toString(),
        address: input.address && input.address.toString(),
        scriptSig: {
          hex: input.scriptSig.toBuffer().toString('hex'),
          asm: input.scriptSig.toString()
        }
      }))
    }
    transformed.outputs = transaction.outputs.map((output, index) => {
      let type
      let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, index)
      if (address) {
        type = address.type
      } else if (output.scriptPubKey.isDataOut()) {
        type = 'nulldata'
      } else {
        type = 'nonstandard'
      }
      return {
        value: output.value.toString(),
        address: output.address && output.address.toString(),
        index,
        scriptPubKey: {
          type,
          hex: output.scriptPubKey.toBuffer().toString('hex'),
          asm: output.scriptPubKey.toString()
        }
      }
    })
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
