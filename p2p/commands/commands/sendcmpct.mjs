import {BufferReader, BufferWriter} from '../../../lib'
import Message from './message'

export default class SendCmpctMessage extends Message {
  constructor({...options}) {
    super('sendcmpct', options)
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeUInt8(this.useCmpctBlock)
    writer.writeUInt64LE(this.cmpctBlockVersion)
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.useCmpctBlock = Boolean(reader.readUInt8())
    this.cmpctBlockVersion = reader.readUInt64LE()
    Message.checkFinished(reader)
  }
}
