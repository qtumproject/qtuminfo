const THREE_HOURS = 3 * 60 * 60

export default class RateLimiter {
  constructor({
    node,
    limit = THREE_HOURS,
    interval = THREE_HOURS * 1000,
    banInterval = THREE_HOURS * 1000,
    whitelist = [],
    whitelistLimit = THREE_HOURS * 10,
    whitelistInterval = THREE_HOURS * 1000,
    banWhitelistInterval = THREE_HOURS * 1000,
    blacklist = [],
    blacklistLimit = 0,
    blacklistInterval = THREE_HOURS * 1000,
    banBlacklistInterval = THREE_HOURS * 1000
  }) {
    this.node = node
    this.clients = {}
    this.whitelist = whitelist
    this.blacklist = blacklist
    this.config = {
      whitelist: {
        totalRequests: whitelistLimit,
        interval: whitelistInterval,
        banInterval: banWhitelistInterval
      },
      blacklist: {
        totalRequests: blacklistLimit,
        interval: blacklistInterval,
        banInterval: banBlacklistInterval
      },
      normal: {
        totalRequests: limit,
        interval,
        banInterval
      }
    }
  }

  middleware() {
    return this._middleware.bind(this)
  }

  async _middleware(ctx, next) {
    let name = RateLimiter.getClientName(ctx)
    let client = this.clients[name]
    ctx.state.rateLimit = {
      clients: this.clients,
      exceeded: false
    }
    if (!client) {
      client = this.addClient(name)
    }
    if (client.type === 'whitelist') {
      await next()
    } else {
      ctx.set('X-RateLimit-Limit', this.config[client.type].totalRequests)
      ctx.set('X-RateLimit-Remaining', this.config[client.type].totalRequests - client.visits)
      ctx.state.rateLimit.exceeded = this.exceeded(client)
      ctx.state.rateLimit.client = client
      if (this.exceeded(client)) {
        this.node.logger.warn('Rate limited:', client)
        ctx.throw(429, 'Rate Limit Exceeded')
      } else {
        ++client.visits
        await next()
      }
    }
  }

  exceeded(client) {
    if (this.config[client.type].totalRequests === -1) {
      return false
    } else {
      let isBanned = client.visits > this.config[client.type].totalRequests
      if (isBanned) {
        client.isBanned = true
      }
      return isBanned
    }
  }

  getClientType(name) {
    if (this.whitelist.includes(name)) {
      return 'whitelist'
    } else if (this.blacklist.includes(name)) {
      return 'blacklist'
    } else {
      return 'normal'
    }
  }

  static getClientName(ctx) {
    return ctx.get('x-forwarded-for') || ctx.request.ip
  }

  addClient(name) {
    let client = {
      name,
      type: this.getClientType(name),
      visits: 1,
      isBanned: false
    }
    let resetTime = this.config[client.type].interval
    let banInterval = this.config[client.type].banInterval
    setTimeout(() => {
      if (name in this.clients && !this.clients[name].isBanned) {
        delete this.clients[name]
      } else {
        setTimeout(() => {
          delete this.clients[name]
        }, banInterval).unref()
      }
    }, resetTime).unref()
    return client
  }
}
