import path from 'path'
import Node from '../node'

export default class QtumNode {
  constructor(options) {
    this.path = options.path
    this.config = options.config
    this.node = null
    this.shuttingDown = false
  }

  get logger() {
    return this.node.logger
  }

  async start() {
    let services = await this.setupServices()
    this.node = new Node({
      ...this.config,
      path: path.resolve(this.path, 'qtuminfo-node.json'),
      services
    })
    this.registerExitHandlers()
    this.node.on('ready', () => this.logger.info('Qtuminfo Node ready.'))
    this.node.on('error', err => this.logger.error(err))
    this.node.start().catch(err => {
      this.logger.error('Failed to start services')
      if (err.stack) {
        this.logger.error(err.stack)
      }
      this.cleanShutdown()
    })
  }

  async loadModule(service) {
    try {
      return (await import(`../services/${service.name}`)).default
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') {
        throw err
      }
      return (await import(path.resolve(process.cwd(), `node_modules/${service.name}`))).default
    }
  }

  async setupServices() {
    let {services = [], servicesConfig = {}} = this.config
    let result = []
    for (let serviceName of services) {
      let service = {
        name: serviceName,
        config: servicesConfig[serviceName] || {}
      }
      service.module = await this.loadModule(service)
      result.push(service)
    }
    return result
  }

  async cleanShutdown() {
    try {
      await this.node.stop()
      this.logger.info('Halted')
      process.exit(0)
    } catch (err) {
      this.logger.error('Failed to stop services:', err)
      process.exit(1)
    }
  }

  exitHandler({sigint}, err) {
    if (err) {
      this.logger.error('Uncaught exception:', err)
      if (err.stack) {
        this.logger.error(err.stack)
      }
      this.node.stop().then(
        () => process.exit(-1),
        err => this.logger.error('Failed to stop services:', err)
      )
    }
    if (sigint && !this.shuttingDown) {
      this.shuttingDown = true
      this.cleanShutdown()
    }
  }

  registerExitHandlers() {
    process.on('uncaughtException', this.exitHandler.bind(this, {exit: true}))
    process.on('SIGINT', this.exitHandler.bind(this, {sigint: true}))
  }
}
