const util = require('util')
const BufferReader = require('../encoding/buffer-reader')
const BufferWriter = require('../encoding/buffer-writer')

class Input {
  constructor({prevTxId, outputIndex, scriptSig, sequence, witness = []}) {
    this.prevTxId = prevTxId
    this.outputIndex = outputIndex
    this.scriptSig = scriptSig
    this.sequence = sequence
    this.witness = witness
  }

  static fromBuffer(buffer) {
    return Input.fromBufferReader(new BufferReader(buffer))
  }

  static fromBufferReader(reader) {
    let prevTxId = Buffer.from(reader.read(32)).reverse()
    let outputIndex = reader.readUInt32LE()
    let scriptSig = reader.readVarLengthBuffer()
    let sequence = reader.readUInt32LE()
    return new Input({prevTxId, outputIndex, scriptSig, sequence})
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    writer.write(Buffer.from(this.prevTxId).reverse())
    writer.writeUInt32LE(this.outputIndex)
    writer.writeVarLengthBuffer(this.scriptSig)
    writer.writeUInt32LE(this.sequence)
  }

  [util.inspect.custom](depth, {indentationLvl}) {
    let indentation = ' '.repeat(indentationLvl && indentationLvl - 1)
    return `Input {
  ${indentation}prevTxId: '${this.prevTxId.toString('hex')}',
  ${indentation}outputIndex: ${this.outputIndex},
  ${indentation}scriptSig: ${this.scriptSig.toString('hex')},
  ${indentation}sequence: ${this.sequence}
${indentation}}`
  }
}

module.exports = Input
