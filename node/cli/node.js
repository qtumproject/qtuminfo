const path = require('path')
const Node = require('../node')

class QtumNode {
  #path = null
  #config = null
  #node = null
  #shuttingDown = false

  constructor(options) {
    this.#path = options.path
    this.#config = options.config
  }

  get logger() {
    return this.#node.logger
  }

  async start() {
    let services = await this.setupServices()
    this.#node = new Node({
      ...this.#config,
      path: path.resolve(this.#path, 'qtuminfo-node.json'),
      services
    })
    this.registerExitHandlers()
    this.#node.on('ready', () => this.logger.info('Qtuminfo Node ready.'))
    this.#node.on('error', err => this.logger.error(err))
    this.#node.start().catch(err => {
      this.logger.error('Failed to start services')
      if (err.stack) {
        this.logger.error(err.stack)
      }
      this.cleanShutdown()
    })
  }

  async setupServices() {
    let {services = [], servicesConfig = {}} = this.#config
    let result = []
    for (let serviceName of services) {
      let service = {
        name: serviceName,
        config: servicesConfig[serviceName] || {}
      }
      service.module = require(`../services/${service.name}`)
      result.push(service)
    }
    return result
  }

  exitHandler({sigint}, err) {
    if (sigint && !this.#shuttingDown) {
      this.#shuttingDown = true
      this.#node.stop()
    } else if (err) {
      this.logger.error('Uncaught exception:', err)
      if (err.stack) {
        this.logger.error(err.stack)
      }
      this.#node.stop()
    }
  }

  registerExitHandlers() {
    process.on('uncaughtException', this.exitHandler.bind(this, {exit: true}))
    process.on('SIGINT', this.exitHandler.bind(this, {sigint: true}))
  }
}

module.exports = QtumNode
