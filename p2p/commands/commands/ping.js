const {BufferReader} = require('../../../lib')
const Message = require('./message')
const {getNonce} = require('./utils')

class PingMessage extends Message {
  constructor({nonce = getNonce(), ...options}) {
    super('ping', options)
    this.nonce = nonce
  }

  get payload() {
    return this.nonce
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.nonce = reader.read(8)
    Message.checkFinished(reader)
  }
}

module.exports = PingMessage
