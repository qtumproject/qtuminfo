import {Writable} from 'stream'
import Router from 'koa-router'
import morgan from 'koa-morgan'
import cors from 'koa-cors'
import compress from 'koa-compress'
import bodyparser from 'koa-bodyparser'
import Service from 'qtuminfo-node/lib/services/base'
import RateLimiter from './components/rate-limiter'
import BlocksController from './controllers/blocks'

export default class QtuminfoAPIService extends Service {
  constructor(options) {
    super(options)
    this.rateLimiterOptions = options.rateLimiterOptions
    this.disableRateLimiter = options.disableRateLimiter
    this._routePrefix = options.routePrefix || this.name
    this.blocks = new BlocksController(this.node)
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

    let router = new Router()

    router.get('/blocks', this.blocks.list.bind(this.blocks))
    router.get('/block/:block', this.blocks.block.bind(this.blocks))
    router.get('/raw-block/:hash', this.blocks.rawBlock.bind(this.blocks))
    router.get('/recent-blocks', this.blocks.recentBlocks.bind(this.blocks))

    app.use(router.routes()).use(router.allowedMethods())
  }
}
