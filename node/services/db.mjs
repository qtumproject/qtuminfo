import Sequelize from 'sequelize'
import {Header} from '../../lib'
import Rpc from '../../rpc'
import generateTip from '../models/tip'
import generateHeader from '../models/header'
import generateBlock from '../models/block'
import generateAddress from '../models/address'
import generateTransaction from '../models/transaction'
import generateTransactionReceipt from '../models/transaction-receipt'
import generateTransactionOutput from '../models/transaction-output'
import generateContractTransaction from '../models/contract-transaction'
import generateBalanceChange from '../models/balance-change'
import generateContract from '../models/contract'
import generateToken from '../models/token'
import Service from './base'

export default class DbService extends Service {
  #genesisHash = null
  #rpcOptions = null
  #sequelize = null
  #Tip = null

  constructor(options) {
    super(options)
    this.#genesisHash = Header.fromBuffer(this.chain.genesis).hash
    this.#rpcOptions = Object.assign({
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
    return new Rpc(this.#rpcOptions)
  }

  getDatabase() {
    return this.#sequelize
  }

  getModel(name) {
    return this.#sequelize.models[name]
  }

  async getServiceTip(serviceName) {
    let tip = await this.#Tip.findByPk(serviceName)
    if (tip) {
      return {height: tip.height, hash: tip.hash}
    } else {
      return {height: 0, hash: this.#genesisHash}
    }
  }

  async updateServiceTip(serviceName, tip) {
    await this.#Tip.upsert({service: serviceName, height: tip.height, hash: tip.hash})
  }

  async start() {
    this.#sequelize = new Sequelize(this.options.mysql.uri, {
      databaseVersion: 1,
      dialectOptions: {
        supportBigNumbers: true,
        bigNumberStrings: true
      },
      logging: false
    })
    generateTip(this.#sequelize)
    generateHeader(this.#sequelize)
    generateAddress(this.#sequelize)
    generateBlock(this.#sequelize)
    generateTransaction(this.#sequelize)
    generateTransactionReceipt(this.#sequelize)
    generateTransactionOutput(this.#sequelize)
    generateContractTransaction(this.#sequelize)
    generateBalanceChange(this.#sequelize)
    generateContract(this.#sequelize)
    generateToken(this.#sequelize)
    this.#Tip = this.#sequelize.models.tip
  }

  async stop() {
    if (this.#sequelize) {
      this.#sequelize.close()
      this.#sequelize = null
    }
  }
}
