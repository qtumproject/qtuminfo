const Sequelize = require('sequelize')
const {Header} = require('../../lib')
const Rpc = require('../../rpc')
const generateTip = require('../models/tip')
const generateHeader = require('../models/header')
const generateBlock = require('../models/block')
const generateAddress = require('../models/address')
const generateTransaction = require('../models/transaction')
const generateTransactionReceipt = require('../models/transaction-receipt')
const generateTransactionOutput = require('../models/transaction-output')
const generateContractTransaction = require('../models/contract-transaction')
const generateBalanceChange = require('../models/balance-change')
const generateContract = require('../models/contract')
const generateToken = require('../models/token')
const Service = require('./base')

class DBService extends Service {
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

module.exports = DBService
