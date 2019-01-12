import fs from 'fs'
import Sequelize from 'sequelize'
import {Header} from 'qtuminfo-lib'
import Rpc from 'qtuminfo-rpc'
import generateTip from '../models/tip'
import generateHeader from '../models/header'
import generateBlock from '../models/block'
import generateAddress from '../models/address'
import generateTransaction from '../models/transaction'
import generateTransactionReceipt from '../models/transaction-receipt'
import generateTransactionOutput from '../models/transaction-output'
import generateContractTransaction from '../models/contract-transaction'
import generateBalanceChange from '../models/balance-change'
import Service from './base'

export default class DbService extends Service {
  constructor(options) {
    super(options)
    this._genesisHash = Header.fromBuffer(this.chain.genesis).hash
    this._rpcOptions = Object.assign({
      protocol: 'http',
      host: 'localhost',
      port: 3889,
      user: 'user',
      password: 'password'
    }, options.rpc)
    this.node.on('stopping', () => {
      this.logger.warn('DB Service: node is stopping, gently closing the database. Please wait, this could take a while')
    })
  }

  get APIMethods() {
    return {
      getRpcClient: this.getRpcClient.bind(this),
      getDatabase: this.getDatabase.bind(this),
      getModel: this.getModel.bind(this),
      getServiceTip: this.getServiceTip.bind(this),
      updateServiceTip: this.updateServiceTip.bind(this)
    }
  }

  getRpcClient() {
    return new Rpc(this._rpcOptions)
  }

  getDatabase() {
    return this._sequelize
  }

  getModel(name) {
    return this._sequelize.models[name]
  }

  async getServiceTip(serviceName) {
    let tip = await this.Tip.findByPk(serviceName)
    if (tip) {
      return {height: tip.height, hash: tip.hash}
    } else {
      return {height: 0, hash: this._genesisHash}
    }
  }

  async updateServiceTip(serviceName, tip) {
    await this.Tip.upsert({service: serviceName, height: tip.height, hash: tip.hash})
  }

  async start() {
    try {
      await fs.promises.access(this.node.datadir)
    } catch (err) {
      await fs.promises.mkdir(this.node.datadir)
    }
    this._sequelize = new Sequelize(this.options.mysql.uri, {
      databaseVersion: 1,
      dialectOptions: {
        supportBigNumbers: true,
        bigNumberStrings: true
      },
      logging: false
    })
    generateTip(this._sequelize)
    generateHeader(this._sequelize)
    generateBlock(this._sequelize)
    generateAddress(this._sequelize)
    generateTransaction(this._sequelize)
    generateTransactionReceipt(this._sequelize)
    generateTransactionOutput(this._sequelize)
    generateContractTransaction(this._sequelize)
    generateBalanceChange(this._sequelize)
    this.Tip = this._sequelize.models.tip
  }

  async stop() {
    if (this._sequelize) {
      this._sequelize.close()
      this._sequelize = null
    }
  }
}
