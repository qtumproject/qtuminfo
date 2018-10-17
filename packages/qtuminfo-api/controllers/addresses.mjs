import {Address} from 'qtuminfo-lib'

export default class AddressesController {
  constructor(node) {
    this.node = node
  }

  async checkAddresses(ctx, next) {
    if (!('address' in ctx.params)) {
      ctx.throw(404)
    }
    let addresses = ctx.params.address.split(',')
    ctx.state.addresses = addresses.map(string => {
      let address = Address.fromString(string, this.node.chain)
      if (!address || address.type === Address.EVM_CONTRACT) {
        ctx.throw(400, `Invalid Address ${string}`)
      }
      return address
    })
    await next()
  }

  async summary(ctx) {
    let summary = await this.node.getAddressSummary(ctx.state.addresses)
    let qrc20TokenBalances = await this.node.getAllQRC20TokenBalances(ctx.state.addresses)
    let balanceRanking
    if (ctx.state.addresses.length === 1) {
      balanceRanking = await this.node.getBalanceRanking(ctx.state.addresses[0])
    }
    ctx.body = {
      balance: summary.balance.toString(),
      totalReceived: summary.totalReceived.toString(),
      totalSent: summary.totalSent.toString(),
      unconfirmed: summary.unconfirmed.toString(),
      staking: summary.staking.toString(),
      mature: summary.mature.toString(),
      qrc20TokenBalances: qrc20TokenBalances.map(token => ({
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString(),
        balance: token.balance.toString()
      })),
      ranking: balanceRanking,
      blocksStaked: summary.blocksStaked,
      totalCount: summary.totalCount
    }
  }

  async balance(ctx) {
    let balance = await this.node.getBalance(ctx.state.addresses)
    ctx.body = balance.toString()
  }

  async matureBalance(ctx) {
    let balance = await this.node.getMatureBalance(ctx.state.addresses)
    ctx.body = balance.toString()
  }

  async utxo(ctx) {
    let utxos = await this.node.getAddressUnspentOutputs(ctx.state.addresses)
    ctx.body = utxos.map(utxo => ({
      transactionId: utxo.id.toString('hex'),
      outputIndex: utxo.index,
      scriptPubKey: utxo.scriptPubKey.toBuffer().toString('hex'),
      address: utxo.address.toString(),
      value: utxo.value.toString(),
      isStake: utxo.isStake,
      blockHeight: utxo.blockHeight,
      confirmations: utxo.confirmations
    }))
  }

  async transactions(ctx) {
    let result = await this.node.getAddressHistory(ctx.state.addresses, ctx.state.pagination)
    ctx.body = {
      totalCount: result.totalCount,
      transactions: result.transactions.map(id => id.toString('hex'))
    }
  }

  async balanceHistory(ctx) {
    let result = await this.node.getAddressBalanceHistory(ctx.state.addresses, ctx.state.pagination)
    ctx.body = {
      totalCount: result.totalCount,
      transactions: result.transactions.map(({id, block, amount, balance}) => ({
        id: id.toString('hex'),
        blockHeight: block.height === 0xffffffff ? null : block.height,
        timestamp: block.timestamp,
        amount: amount.toString(),
        balance: balance.toString()
      }))
    }
  }

  async qrc20BalanceHistory(ctx) {
    let tokens = 'all'
    if ('tokens' in ctx.query) {
      tokens = []
      let addresses = ctx.query.tokens.split(',')
      for (let address of addresses) {
        if (/^[0-9a-f]{40}$/.test(address)) {
          tokens.push(Buffer.from(address, 'hex'))
        } else {
          ctx.throw(400, `Invalid token address ${address}`)
        }
      }
    }
    let result = await this.node.getAddressQRC20TokenBalanceHistory(
      ctx.state.addresses,
      tokens,
      ctx.state.pagination
    )
    ctx.body = {
      totalCount: result.totalCount,
      transactions: result.transactions.map(({id, block, data}) => ({
        id: id.toString('hex'),
        blockHeight: block.height === 0xffffffff ? null : block.height,
        timestamp: block.timestamp,
        data: data.map(({token, amount, balance}) => ({
          token: {
            address: token.address.toString('hex'),
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            totalSupply: token.totalSupply == null ? null : token.totalSupply.toString(),
            version: token.version
          },
          amount: amount.toString(),
          balance: balance.toString()
        }))
      }))
    }
  }
}
