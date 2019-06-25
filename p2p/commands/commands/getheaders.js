const {BufferReader, BufferWriter} = require('../../../lib')
const Message = require('./message')

class GetHeadersMessage extends Message {
  constructor({starts, stop, ...options}) {
    super('getheaders', options)
    this.version = options.protocolVersion
    this.starts = starts
    this.stop = stop || Buffer.alloc(32)
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeUInt32LE(this.version)
    writer.writeVarintNumber(this.starts.length)
    for (let start of this.starts) {
      writer.write(Buffer.from(start).reverse())
    }
    writer.write(Buffer.from(this.stop).reverse())
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.version = reader.readUInt32LE()
    let startCount = reader.readVarintNumber()
    this.starts = []
    for (let i = 0; i < startCount; ++i) {
      this.starts.push(Buffer.from(reader.read(32)).reverse())
    }
    this.stop = Buffer.from(reader.read(32)).reverse()
    Message.checkFinished(reader)
  }
}

module.exports = GetHeadersMessage
