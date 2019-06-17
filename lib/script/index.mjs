import util from 'util'
import BufferReader from '../encoding/buffer-reader'
import BufferWriter from '../encoding/buffer-writer'
import Opcode from './opcode'

export class InvalidScriptError extends Error {
  constructor(...args) {
    super(...args)
    Error.captureStackTrace(this, this.constructor)
  }

  get name() {
    return this.constructor.name
  }
}

export default class Script {
  constructor(chunks) {
    this.chunks = chunks
  }

  static parseBuffer(buffer) {
    let reader = new BufferReader(buffer)
    let chunks = []
    while (!reader.finished) {
      let code = reader.readUInt8()
      if (code > 0 && code < Opcode.OP_PUSHDATA1) {
        let length = code
        let buf = reader.read(length)
        chunks.push({code, buffer: buf})
      } else if (code === Opcode.OP_PUSHDATA1) {
        let length = reader.readUInt8()
        let buf = reader.read(length)
        chunks.push({code, buffer: buf})
      } else if (code === Opcode.OP_PUSHDATA2) {
        let length = reader.readUInt16LE()
        let buf = reader.read(length)
        chunks.push({code, buffer: buf})
      } else if (code === Opcode.OP_PUSHDATA4) {
        let length = reader.readUInt32LE()
        let buf = reader.read(length)
        chunks.push({code, buffer: buf})
      } else {
        chunks.push({code})
      }
    }
    return chunks
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    for (let {code, buffer} of this.chunks) {
      writer.writeUInt8(code)
      if (buffer) {
        if (code < Opcode.OP_PUSHDATA1) {
          writer.write(buffer)
        } else if (code === Opcode.OP_PUSHDATA1) {
          writer.writeUInt8(buffer.length)
          writer.write(buffer)
        } else if (code === Opcode.OP_PUSHDATA2) {
          writer.writeUInt16LE(buffer.length)
          writer.write(buffer)
        } else if (code === Opcode.OP_PUSHDATA4) {
          writer.writeUInt32LE(buffer.length)
          writer.write(buffer)
        }
      }
    }
  }

  toString() {
    let chunks = this.chunks.map(({code, buffer}) => {
      if (buffer) {
        return buffer.toString('hex')
      } else if (code in Opcode.reverseMap) {
        return Opcode.reverseMap[code]
      } else {
        return code
      }
    })
    return chunks.join(' ')
  }

  static buildChunk(buffer) {
    if (buffer.length < Opcode.OP_PUSHDATA1) {
      return {code: buffer.length, buffer}
    } else if (buffer.length <= 0xff) {
      return {code: Opcode.OP_PUSHDATA1, buffer}
    } else if (buffer.length <= 0xffff) {
      return {code: Opcode.OP_PUSHDATA2, buffer}
    } else {
      return {code: Opcode.OP_PUSHDATA4, buffer}
    }
  }

  [util.inspect.custom]() {
    return `<Script ${this.toString()}>`
  }

  isEmpty() {
    return this.chunks.length === 0
  }
}
