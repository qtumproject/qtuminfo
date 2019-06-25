const assert = require('assert')
const EventEmitter = require('events')
const Bus = require('./bus')
const {Chain} = require('../lib')
const Logger = require('./logger')

class Node extends EventEmitter {
  #configPath = null
  services = new Map()
  #unloadedServices = []

  constructor(config) {
    super()
    this.#configPath = config.path
    this.logger = new Logger({formatting: config.formatLogs})
    this.chain = Chain.get(config.chain)
    this.#unloadedServices = config.services || []
  }

  openBus() {
    return new Bus({node: this})
  }

  getAllAPIMethods() {
    let methods = {}
    for (let service of this.services.values()) {
      Object.assign(methods, service.APIMethods)
    }
    return methods
  }

  getAllPublishEvents() {
    let events = []
    for (let service of this.services.values()) {
      events.push(...service.publishEvents)
    }
    return events
  }

  static getServiceOrder(services) {
    let names = []
    let servicesByName = {}
    for (let service of services) {
      names.push(service.name)
      servicesByName[service.name] = service
    }
    let stack = []
    let stackNames = new Set()
    function addToStack(names) {
      for (let name of names) {
        let service = servicesByName[name]
        addToStack(service.module.dependencies)
        if (!stackNames.has(name)) {
          stack.push(service)
          stackNames.add(name)
        }
      }
    }
    addToStack(names)
    return stack
  }

  getServicesByOrder() {
    let names = []
    let servicesByName = {}
    for (let [name, service] of this.services) {
      names.push(name)
      servicesByName[name] = service
    }
    let stack = []
    let stackNames = new Set()
    function addToStack(names) {
      for (let name of names) {
        let service = servicesByName[name]
        addToStack(service.constructor.dependencies)
        if (!stackNames.has(name)) {
          stack.push(service)
          stackNames.add(name)
        }
      }
    }
    addToStack(names)
    return stack
  }

  async startService(serviceInfo) {
    this.logger.info('Starting', serviceInfo.name)
    let config = serviceInfo.config || {}
    config.node = this
    config.name = serviceInfo.name
    let service = new serviceInfo.module(config)
    this.services.set(serviceInfo.name, service)
    await service.start()
    let methodNames = new Set()
    for (let [name, method] of Object.entries(service.APIMethods)) {
      assert(!methodNames.has(name), `API method name conflicts: ${name}`)
      methodNames.add(name)
      this[name] = method
    }
  }

  async start() {
    this.logger.info('Using config:', this.#configPath)
    this.logger.info('Using chain:', this.chain.name)
    for (let service of Node.getServiceOrder(this.#unloadedServices)) {
      await this.startService(service)
    }
    this.emit('ready')
  }

  async stop() {
    if (this.stopping) {
      return
    }
    try {
      this.logger.info('Beginning shutdown')
      let services = Node.getServiceOrder(this.#unloadedServices).reverse()
      this.stopping = true
      this.emit('stopping')
      for (let service of services) {
        if (this.services.has(service.name)) {
          this.logger.info('Stopping', service.name)
          await this.services.get(service.name).stop()
        } else {
          this.logger.info('Stopping', service.name, '(not started)')
        }
      }
      this.logger.info('Halted')
      process.exit(0)
    } catch (err) {
      this.logger.error('Failed to stop services:', err)
      process.exit(1)
    }
  }
}

module.exports = Node
