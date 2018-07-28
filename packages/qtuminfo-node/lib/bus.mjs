import EventEmitter from 'events'

export default class Bus extends EventEmitter {
  constructor({node, remoteAddress}) {
    super()
    this.node = node
    this.remoteAddress = remoteAddress
  }

  subscribe(name, ...args) {
    for (let service of this.node.services.values()) {
      for (let event of service.publishEvents) {
        if (name === event.name) {
          event.subscribe(this, ...args)
        }
      }
    }
  }

  unsubscribe(name, ...args) {
    for (let service of this.node.services.values()) {
      for (let event of service.publishEvents) {
        if (name === event.name) {
          event.unsubscribe(this, ...args)
        }
      }
    }
  }

  close() {
    for (let service of this.node.services.values()) {
      for (let event of service.publishEvents) {
        event.unsubscribe(this)
      }
    }
  }
}
