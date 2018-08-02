import mongodb from 'mongodb'
import {Header as RawHeader} from 'qtuminfo-lib'
import Rpc from 'qtuminfo-rpc'
import Info from '../models/info'
import Header from '../models/header'
import Block from '../models/block'
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
    let tip = await Info.findOne({key: `tip-${serviceName}`})
    if (tip) {
      return {height: tip.value.height, hash: tip.value.hash.buffer}
    } else {
      return {height: 0, hash: this._genesisHash}
    }
  }

  async updateServiceTip(serviceName, tip) {
    await Info.findOneAndUpdate(
      {key: `tip-${serviceName}`},
      {$set: {value: tip}},
      {upsert: true}
    )
  }

  async start() {
    this._connection = await mongodb.MongoClient.connect(
      this.options.mongodb.url,
      {
        poolSize: 20,
        useNewUrlParser: true
      }
    )
    let db = this._connection.db(this.options.mongodb.database)
    await Info.init(db)
    await Header.init(db)
    await Block.init(db, this.chain)
  }

  async stop() {
    if (this._connection) {
      await this._connection.close()
      this._connection = null
    }
  }
}
