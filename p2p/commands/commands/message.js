const assert = require('assert')
const {BufferWriter, Hash} = require('../../../lib')

class Message {
  constructor(command, options) {
    this.command = command
    this.chain = options.chain
  }

  get payload() {
    return Buffer.alloc(0)
  }

  set payload(payload) {}

  static fromBuffer(payload, options) {
    let message = new this.constructor(options)
    message.payload = payload
    return message
  }

  toBuffer() {
    let command = Buffer.alloc(12)
    command.write(this.command, 'ascii')
    let payload = this.payload
    let checksum = Hash.sha256sha256(payload).slice(0, 4)
    let writer = new BufferWriter()
    writer.write(this.chain.networkMagic)
    writer.write(command)
    writer.writeUInt32LE(payload.length)
    writer.write(checksum)
    writer.write(payload)
    return writer.toBuffer()
  }

  static checkFinished(reader) {
    assert(reader.finished, 'Data still available after parsing')
  }
}

module.exports = Message
