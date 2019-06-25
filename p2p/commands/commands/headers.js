const {BufferReader, BufferWriter, Header} = require('../../../lib')
const Message = require('./message')

class HeadersMessage extends Message {
  constructor({headers, ...options}) {
    super('headers', options)
    this.headers = headers
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeVarintNumber(this.geaders.length)
    for (let header of this.headers) {
      header.toBufferWriter(writer)
      writer.writeUInt8(0)
    }
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    let count = reader.readVarintNumber()
    this.headers = []
    for (let i = 0; i < count; ++i) {
      this.headers.push(Header.fromBufferReader(reader))
      reader.readUInt8()
    }
    Message.checkFinished(reader)
  }
}

module.exports = HeadersMessage
