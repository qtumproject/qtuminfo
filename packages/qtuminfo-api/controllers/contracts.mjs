import {Address} from 'qtuminfo-lib'

export default class ContractsController {
  constructor(node) {
    this.node = node
  }

  async contract(ctx, next) {
    let address = ctx.params.contract
    if (!/^[0-9a-f]{40}$/.test(address)) {
      ctx.throw(400)
    }
    let contract = await this.node.getContract(Buffer.from(address, 'hex'))
    if (contract) {
      ctx.state.contract = contract
      await next()
    } else {
      ctx.throw(404)
    }
  }

  async show(ctx) {
    let contract = ctx.state.contract
    if (contract.qrc20) {
      contract.qrc20.holders = await this.node.getQRC20TokenHolders(contract.address)
    }
    let summary = await this.node.getContractSummary(contract.address)
    let qrc20TokenBalances = await this.node.getAllQRC20TokenBalances(
      new Address({type: Address.EVM_CONTRACT, data: contract.address, chain: this.node.chain})
    )
    ctx.body = {
      address: contract.address.toString('hex'),
      owner: contract.owner && contract.owner.toString(),
      createTransactionId: contract.createTransactionId && contract.createTransactionId.toString('hex'),
      createHeight: contract.createHeight,
      type: contract.type,
      ...contract.qrc20
        ? {
          qrc20: {
            name: contract.qrc20.name,
            symbol: contract.qrc20.symbol,
            decimals: contract.qrc20.decimals,
            totalSupply: contract.qrc20.totalSupply == null ? null : contract.qrc20.totalSupply.toString(),
            version: contract.qrc20.version,
            holders: contract.qrc20.holders
          }
        }
        : {},
      ...contract.qrc721
        ? {
          qrc721: {
            name: contract.qrc721.name,
            symbol: contract.qrc721.symbol,
            totalSupply: contract.qrc721.totalSupply == null ? null : contract.qrc721.totalSupply.toString()
          }
        }
        : {},
      balance: summary.balance.toString(),
      totalReceived: summary.totalReceived.toString(),
      totalSent: summary.totalSent.toString(),
      qrc20TokenBalances: qrc20TokenBalances.map(token => ({
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString(),
        balance: token.balance.toString()
      })),
      totalCount: summary.totalCount
    }
  }

  async transactions(ctx) {
    let result = await this.node.getContractHistory(ctx.state.contract.address, ctx.state.pagination)
    ctx.body = {
      totalCount: result.totalCount,
      transactions: result.transactions.map(id => id.toString('hex'))
    }
  }

  async qrc20Tokens(ctx) {
    let result = await this.node.listQRC20Tokens(ctx.state.pagination)
    ctx.body = {
      totalCount: result.totalCount,
      tokens: result.tokens.map(token => ({
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString(),
        holders: token.holders
      }))
    }
  }

  async richList(ctx) {
    let result = await this.node.getQRC20TokenRichList(ctx.state.contract.address, ctx.state.pagination)
    ctx.body = {
      totalCount: result.totalCount,
      list: result.list.map(({address, balance}) => ({
        address: address.toString(),
        balance: balance.toString()
      }))
    }
  }
}
