const EventEmitter = require('events')

class Bus extends EventEmitter {
  #node = null

  constructor({node}) {
    super()
    this.#node = node
  }

  subscribe(name, ...args) {
    for (let service of this.#node.services.values()) {
      for (let event of service.publishEvents) {
        if (name === event.name) {
          event.subscribe(this, ...args)
        }
      }
    }
  }

  unsubscribe(name, ...args) {
    for (let service of this.#node.services.values()) {
      for (let event of service.publishEvents) {
        if (name === event.name) {
          event.unsubscribe(this, ...args)
        }
      }
    }
  }

  close() {
    for (let service of this.#node.services.values()) {
      for (let event of service.publishEvents) {
        event.unsubscribe(this)
      }
    }
  }
}

module.exports = Bus
