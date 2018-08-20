import fs from 'fs'
import assert from 'assert'
import http from 'http'
import https from 'https'
import Koa from 'koa'
import bodyparser from 'koa-bodyparser'
import mount from 'koa-mount'
import socketio from 'socket.io'
import Service from './base'

export default class WebService extends Service {
  constructor(options) {
    super(options)
    this.port = options.port || this.node.port || 3001
    this.jsonRequestLimit = options.jsonRequestLimit || '100kb'
    this.node.on('ready', () => {
      this.eventNames = this.getEventNames()
      this.setupAllRoutes()
      this.server.listen(this.port)
      this.createMethodsMap()
    })
  }

  async start() {
    this.app = new Koa()
    this.app.use(bodyparser({jsonLimit: this.jsonRequestLimit}))
    if (this.https) {
      this.transformHttpsOptions()
      this.server = https.createServer(this.httpsOptions, this.app.callback())
    } else {
      this.server = http.createServer(this.app.callback())
    }
    this.io = socketio.listen(this.server)
    this.io.on('connection', this.socketHandler.bind(this))
  }

  async stop() {
    if (this.server) {
      this.server.close()
    }
  }

  setupAllRoutes() {
    for (let service of this.node.services.values()) {
      if (service.routePrefix != null) {
        let subApp = new Koa()
        this.app.use(mount(`/${service.routePrefix}`, subApp))
        service.setupRoutes(subApp)
      }
    }
  }

  createMethodsMap() {
    this.methods = this.node.getAllAPIMethods()
  }

  getEventNames() {
    let events = this.node.getAllPublishEvents()
    let eventNames = new Set()
    function addEventName(name) {
      assert(!eventNames.has(name), `duplicate event: ${name}`)
      eventNames.add(name)
    }
    for (let event of events) {
      addEventName(event.name)
      if (event.extraEvents) {
        for (let name of event.extraEvents) {
          addEventName(name)
        }
      }
    }
  }

  static getRemoteAddress(socket) {
    return socket.client.request.headers['x-forwarded-for'] || socket.conn.remoteAddress
  }

  socketHandler(socket) {
    let remoteAddress = WebService.getRemoetAddress()
    let bus = this.node.openBus({remoteAddress})
    socket.on('subscribe', (name, params) => {
      this.logger.info(remoteAddress, 'web socket subscribe:', name)
      bus.subscribe(name, params)
    })
    socket.on('unsubscribe', (name, params) => {
      this.logger.info(remoteAddress, 'web socket unsubscribe:', name)
      bus.unsubscribe(name, params)
    })
    for (let eventName of this.eventNames) {
      bus.on(eventName, ...args => {
        if (socket.connected) {
          socket.emit(eventName, ...args)
        }
      })
    }
    socket.on('disconnect', () => {
      this.logger.info(remoteAddress, 'web socket disconnect')
      bus.close()
    })
  }

  socketMessageHandler({method, params = []}, socketCallback) {
    if (method in this.methods) {
      this.methods[method](...params).then(
        result => socketCallback({result}),
        err => socketCallback({message: err.toString()})
      )
    } else {
      socketCallback({error: {message: 'Method not found'}})
    }
  }

  transformHttpsOptions() {
    assert(this.httpsOptions && this.httpsOptions.key && this.httpsOptions.cert, 'missing https options')
    this.httpsOptions = {
      key: fs.readFileSync(this.httpsOptions.key),
      cert: fs.readFileSync(this.httpsOptions.cert)
    }
  }
}
