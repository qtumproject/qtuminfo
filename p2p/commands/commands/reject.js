const {BufferReader, BufferWriter} = require('../../../lib')
const Message = require('./message')

const codes = {
  MALFORMED: 0x01,
  INVALID: 0x10,
  OBSOLETE: 0x11,
  DUPLICATE: 0x12,
  NONSTANDARD: 0x40,
  DUST: 0x41,
  INSUFFICIENTFEE: 0x42,
  CHECKPOINT: 0x43
}

class RejectMessage extends Message {
  constructor({message, code, reason, data, ...options}) {
    super('reject', options)
    this.message = message
    this.code = code
    this.reason = reason
    this.data = data
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeVarLengthBuffer(Buffer.from(this.message, 'ascii'))
    writer.writeUInt8(this.code)
    writer.writeVarLengthBuffer(Buffer.from(this.reason, 'ascii'))
    writer.write(this.data)
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.message = reader.readVarLengthBuffer().toString('ascii')
    this.code = reader.readUInt8()
    this.reason = reader.readVarLengthBuffer().toString('ascii')
    this.data = reader.readAll()
    Message.checkFinished(reader)
  }
}

exports = module.exports = RejectMessage
exports.codes = codes
