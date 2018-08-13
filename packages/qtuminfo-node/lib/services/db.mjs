import mongoose from 'mongoose'
import {Header as RawHeader} from 'qtuminfo-lib'
import Rpc from 'qtuminfo-rpc'
import Tip from '../models/tip'
import Service from './base'

export default class DbService extends Service {
  constructor(options) {
    super(options)
    this._genesisHash = RawHeader.fromBuffer(this.chain.genesis).hash
    this._rpcClient = new Rpc(Object.assign({
      protocol: 'http',
      host: 'localhost',
      port: 3889,
      user: 'user',
      password: 'password'
    }, options.rpc))
    this.node.on('stopping', () => {
      this.logger.warn('DB Service: node is stopping, gently closing the database. Please wait, this could take a while')
    })
    mongoose.chain = this.chain
  }

  get APIMethods() {
    return {
      getRpcClient: this.getRpcClient.bind(this),
      getServiceTip: this.getServiceTip.bind(this),
      updateServiceTip: this.updateServiceTip.bind(this)
    }
  }

  getRpcClient() {
    return this._rpcClient
  }

  async getServiceTip(serviceName) {
    let tip = await Tip.findOne({service: serviceName})
    if (tip) {
      return {height: tip.height, hash: tip.hash}
    } else {
      return {height: 0, hash: this._genesisHash}
    }
  }

  async updateServiceTip(serviceName, tip) {
    await Tip.findOneAndUpdate(
      {service: serviceName},
      {height: tip.height, hash: tip.hash},
      {upsert: true}
    )
  }

  async start() {
    this._connection = await mongoose.connect(
      this.options.mongodb.url + this.options.mongodb.database,
      {
        poolSize: 20,
        useNewUrlParser: true
      }
    )
  }

  async stop() {
    if (this._connection) {
      await mongoose.disconnect()
      this._connection = null
    }
  }
}
