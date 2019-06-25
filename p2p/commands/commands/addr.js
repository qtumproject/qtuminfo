const {BufferReader, BufferWriter} = require('../../../lib')
const Message = require('./message')
const {parseAddress, writeAddress} = require('./utils')

class AddrMessage extends Message {
  constructor({addresses = [], ...options}) {
    super('addr', options)
    this.addresses = addresses
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeVarintNumber(this.addresses.length)
    for (let address of this.addresses) {
      writer.writeUInt32LE(address.timestamp)
      writeAddress(writer, address)
    }
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    let addressCount = reader.readVarintNumber()
    this.addresses = []
    for (let i = 0; i < addressCount; ++i) {
      let timestamp = reader.readUInt32LE()
      let address = parseAddress(reader)
      address.timestamp = timestamp
      this.addresses.push(address)
    }
    Message.checkFinished(reader)
  }
}

module.exports = AddrMessage
