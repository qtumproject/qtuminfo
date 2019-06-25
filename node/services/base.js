const EventEmitter = require('events')

class Service extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.node = options.node
    this.name = options.name
    this.chain = options.node.chain
    this.logger = options.node.logger
  }

  static get dependencies() {
    return []
  }

  get APIMethods() {
    return []
  }

  get publishEvents() {
    if (!this.subscriptions) {
      return []
    }
    return Object.keys(this.subscriptions).map(name => ({
      name: `${this.name}/${name}`,
      subscribe: this.subscribe.bind(this, name),
      unsubscribe: this.unsubscribe.bind(this, name)
    }))
  }

  get routePrefix() {
    return null
  }

  async start() {}

  async stop() {}

  async onHeaders() {}

  async onBlock() {}

  async onSynced() {}

  async onReorg() {}

  subscribe(name, emitter) {
    let subscription = this.subscriptions[name]
    subscription.push(emitter)
    this.logger.info('Subscribe:', `${this.name}/${name},`, 'total:', subscription.length)
  }

  unsubscribe(name, emitter) {
    let subscription = this.subscriptions[name]
    let index = subscription.indexOf(emitter)
    if (index >= 0) {
      subscription.splice(index, 1)
      this.logger.info('Unsubscribe:', `${this.name}/${name},`, 'total:', subscription.length)
    }
  }
}

module.exports = Service
