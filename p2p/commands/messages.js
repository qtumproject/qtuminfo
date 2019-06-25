const {Hash} = require('../../lib')
const messageMap = require('./commands')
const Inventory = require('./inventory')

const MINIMUM_LENGTH = 20
const PAYLOAD_START = 16

class Messages {
  #chain = null
  #commands = {}

  constructor(options) {
    this.#chain = options.chain
    for (let [command, Command] of Object.entries(messageMap)) {
      this[command] = this.#commands[command] = (args = {}) => new Command({...args, ...options})
    }
    for (let command of ['getdata', 'inv']) {
      let Command = messageMap[command]
      Command.forTransaction = data => new Command([Inventory.forTransaction(data)])
      Command.forBlock = data => new Command([Inventory.forBlock(data)])
      Command.forFilteredBlock = data => new Command([Inventory.forFilteredBlock(data)])
    }
  }

  parseBuffer(buffer) {
    if (buffer.length < MINIMUM_LENGTH || !this._discardUntilNextMessage(buffer)) {
      return
    }
    let payloadLength = buffer.slice(PAYLOAD_START).readUInt32LE(0)
    let messageLength = payloadLength + 24
    if (buffer.length < messageLength) {
      return
    }
    let command = buffer.slice(4, 16)
      .toString('ascii')
      .replace(/\0+$/, '')
    let checksum = buffer.slice(20, 24)
    let payload = buffer.slice(24, messageLength)
    buffer.skip(messageLength)
    if (Buffer.compare(checksum, Hash.sha256sha256(payload).slice(0, 4)) === 0) {
      return this._buildFromBuffer(command, payload)
    }
  }

  _discardUntilNextMessage(buffer) {
    for (let i = 0; ; ++i) {
      if (Buffer.compare(buffer.slice(0, 4), this.#chain.networkMagic) === 0) {
        buffer.skip(i)
        return true
      } else if (i > buffer.length - 4) {
        buffer.skip(i)
        return false
      }
    }
  }

  _buildFromBuffer(command, payload) {
    if (!this.#commands[command]) {
      return
    }
    let message = this.#commands[command]()
    if (message) {
      message.payload = payload
      return message
    } else {
      throw new Error(`Unsupported message command: ${command}`)
    }
  }
}

module.exports = Messages
