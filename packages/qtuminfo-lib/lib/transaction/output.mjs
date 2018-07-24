import util from 'util'
import {BufferReader, BufferWriter, Script} from '..'

export default class Output {
  constructor({value, scriptPubKey}) {
    this.value = value
    this.scriptPubKey = scriptPubKey
  }

  static fromBuffer(buffer) {
    return Output.fromBufferReader(new BufferReader(buffer))
  }

  static fromBufferReader(reader) {
    let value = reader.readUInt64LE()
    let scriptPubKey = Script.fromBuffer(reader.readVarLengthBuffer())
    return new Output({scriptPubKey, value})
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    writer.writeUInt64LE(this.value)
    writer.writeVarLengthBuffer(this.scriptPubKey.toBuffer())
  }

  [util.inspect.custom]() {
    return `<Output (${this.value} satoshis) ${this.scriptPubKey}>`
  }

  isEmpty() {
    return this.value === 0n && this.scriptPubKey.isEmpty()
  }
}
