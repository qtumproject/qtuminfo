import {Writable} from 'stream'
import Router from 'koa-router'
import morgan from 'koa-morgan'
import cors from 'koa-cors'
import compress from 'koa-compress'
import bodyparser from 'koa-bodyparser'
import Service from 'qtuminfo-node/lib/services/base'
import RateLimiter from './components/rate-limiter'
import AddressesController from './controllers/addresses'
import BlocksController from './controllers/blocks'
import ContractsController from './controllers/contracts'
import MiscController from './controllers/misc'
import TransactionsController from './controllers/transactions'

export default class QtuminfoAPIService extends Service {
  constructor(options) {
    super(options)
    this.rateLimiterOptions = options.rateLimiterOptions
    this.disableRateLimiter = options.disableRateLimiter
    this._routePrefix = options.routePrefix || this.name
    this.addresses = new AddressesController(this.node)
    this.blocks = new BlocksController(this.node)
    this.contracts = new ContractsController(this.node)
    this.misc = new MiscController(this.node)
    this.transactions = new TransactionsController(this.node)
  }

  static get dependencies() {
    return ['address', 'balance', 'contract', 'block', 'header', 'mempool', 'transaction', 'web']
  }

  get routePrefix() {
    return this._routePrefix
  }

  createLoggerInfoStream() {
    const that = this
    class Logger extends Writable {
      _write(chunk, encoding, callback) {
        that.node.logger.info(chunk.slice(0, -1).toString())
        callback()
      }
    }
    return new Logger()
  }

  getRemoteAddress(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress
  }

  setupRoutes(app) {
    if (!this.disableRateLimiter) {
      let limiter = new RateLimiter({node: this.node, ...this.rateLimiterOptions})
      app.use(limiter.middleware())
    }
    morgan.token('remote-forward-addr', req => this.getRemoteAddress(req))
    let loggerFormat = ':remote-forward-addr ":method :url" :status :res[content-length] :response-time ":user-agent" '
    let loggerStream = this.createLoggerInfoStream()
    app.use(morgan(loggerFormat, {stream: loggerStream}))
    app.use(cors())
    app.use(compress())
    app.use(bodyparser())

    app.use(async (ctx, next) => {
      try {
        await next()
      } catch (err) {
        ctx.status = err.status || 500
        app.emit('error', err, ctx)
      }
    })

    app.use(async (ctx, next) => {
      if (!['GET', 'POST'].includes(ctx.method)) {
        return await next()
      }
      let object = {GET: ctx.query, POST: ctx.request.body}[ctx.method]
      ctx.state.pagination = {}
      if ('pageSize' in object) {
        ctx.state.pagination.pageSize = Number.parseInt(object.pageSize)
        if (!(ctx.state.pagination.pageSize > 0)) {
          ctx.throw(400)
        }
      }
      if ('page' in object) {
        ctx.state.pagination.pageIndex = Number.parseInt(object.page)
        if (!(ctx.state.pagination.pageIndex >= 0)) {
          ctx.throw(400)
        }
      }
      if ('reversed' in object) {
        ctx.state.pagination.reversed = ![false, 'false', 0, '0'].includes(object.reversed)
      }
      await next()
    })

    let router = new Router()

    router.get(
      '/address/:address',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.summary.bind(this.addresses)
    )
    router.get(
      '/address/:address/balance',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.balance.bind(this.addresses)
    )
    router.get(
      '/address/:address/mature-balance',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.matureBalance.bind(this.addresses)
    )
    router.get(
      '/address/:address/utxo',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.utxo.bind(this.addresses)
    )
    router.get(
      '/address/:address/txs',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.transactions.bind(this.addresses)
    )
    router.get(
      '/address/:address/balance-history',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.balanceHistory.bind(this.addresses)
    )
    router.get(
      '/address/:address/qrc20-balance-history',
      this.addresses.checkAddresses.bind(this.addresses),
      this.addresses.qrc20BalanceHistory.bind(this.addresses)
    )

    router.get('/blocks', this.blocks.list.bind(this.blocks))
    router.get('/block/:block', this.blocks.block.bind(this.blocks))
    router.get('/raw-block/:hash', this.blocks.rawBlock.bind(this.blocks))
    router.get('/recent-blocks', this.blocks.recentBlocks.bind(this.blocks))

    router.get('/contract/qrc20-tokens', this.contracts.qrc20Tokens.bind(this.contracts))
    router.get(
      '/contract/:contract',
      this.contracts.contract.bind(this.contracts),
      this.contracts.show.bind(this.contracts)
    )
    router.get(
      '/contract/:contract/txs',
      this.contracts.contract.bind(this.contracts),
      this.contracts.transactions.bind(this.contracts)
    )
    router.get(
      '/contract/:contract/rich-list',
      this.contracts.contract.bind(this.contracts),
      this.contracts.richList.bind(this.contracts)
    )

    router.get('/info', this.misc.info.bind(this.misc))
    router.get('/supply', this.misc.supply.bind(this.misc))
    router.get('/circulating-supply', this.misc.circulatingSupply.bind(this.misc))
    router.get('/search/:id', this.misc.classify.bind(this.misc))

    router.get(
      '/tx/:id',
      this.transactions.transaction.bind(this.transactions),
      this.transactions.show.bind(this.transactions)
    )
    router.get(
      '/txs/:ids',
      this.transactions.transactions.bind(this.transactions),
      this.transactions.show.bind(this.transactions)
    )
    router.get('/raw-tx/:id', this.transactions.rawTransaction.bind(this.transactions))

    app.use(router.routes()).use(router.allowedMethods())
  }
}
