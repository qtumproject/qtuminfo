import util from 'util'
import {BufferReader, BufferWriter, Hash} from '..'
import Input from './input'
import Output from './output'

export default class Transaction {
  constructor({version, inputs, outputs, witnesses, lockTime, marker = null, flag = null}) {
    this.version = version
    this.inputs = inputs
    this.outputs = outputs
    this.witnesses = witnesses
    this.lockTime = lockTime
    this.marker = marker
    this.flag = flag
  }

  get id() {
    this._id = this._id || Hash.sha256sha256(this.toHashBuffer()).reverse()
    return this._id
  }

  get hash() {
    this._hash = this._hash || Hash.sha256sha256(this.toBuffer()).reverse()
    return this._hash
  }

  get size() {
    return this.toBuffer().length
  }

  static fromBuffer(buffer) {
    return Transaction.fromBufferReader(new BufferReader(buffer))
  }

  static fromBufferReader(reader) {
    let version = reader.readUInt32LE()
    let inputs = []
    let marker = null
    let flag = null
    let outputs = []
    let witnesses = []
    let lockTime = null
    let inputCount = reader.readVarintNumber()
    if (!inputCount) {
      marker = inputCount
      flag = reader.readUInt8()
      inputCount = reader.readVarintNumber()
    }
    for (let i = 0; i < inputCount; ++i) {
      inputs.push(Input.fromBufferReader(reader))
    }
    let outputCount = reader.readVarintNumber()
    for (let i = 0; i < outputCount; ++i) {
      outputs.push(Output.fromBufferReader(reader))
    }
    if (flag) {
      for (let i = 0; i < inputCount; ++i) {
        let witnessCount = reader.readVarintNumber()
        let witness = []
        if (witnessCount) {
          for (let j = 0; j < witnessCount; ++j) {
            witness.push(reader.readVarLengthBuffer())
          }
        }
        witnesses.push(witness)
      }
    }
    lockTime = reader.readUInt32LE()
    return new Transaction({version, inputs, outputs, witnesses, marker, flag, lockTime})
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toHashBuffer() {
    let writer = new BufferWriter()
    this.toHashBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    writer.writeInt32LE(this.version)
    if (this.marker != null) {
      writer.writeUInt8(0)
    }
    if (this.flag != null) {
      writer.writeUInt8(this.flag)
    }
    writer.writeVarintNumber(this.inputs.length)
    for (let input of this.inputs) {
      input.toBufferWriter(writer)
    }
    writer.writeVarintNumber(this.outputs.length)
    for (let output of this.outputs) {
      output.toBufferWriter(writer)
    }
    if (this.flag) {
      for (let witness of this.witnesses) {
        writer.writeVarintNumber(witness.length)
        for (let item of witness) {
          writer.writeVarLengthBuffer(item)
        }
      }
    }
    writer.writeUInt32LE(this.lockTime)
  }

  toHashBufferWriter(writer) {
    writer.writeInt32LE(this.version)
    writer.writeVarintNumber(this.inputs.length)
    for (let input of this.inputs) {
      input.toBufferWriter(writer)
    }
    writer.writeVarintNumber(this.outputs.length)
    for (let output of this.outputs) {
      output.toBufferWriter(writer)
    }
    writer.writeUInt32LE(this.lockTime)
  }

  [util.inspect.custom]() {
    return `<Transaction ${this.id.toString('hex')}>`
  }

  isCoinbase() {
    return this.inputs.length === 1
      && Buffer.compare(this.inputs[0].prevTxId, Buffer.alloc(32)) === 0
      && this.outputs.length > 0
  }

  isCoinstake() {
    return this.inputs.length > 0 && Buffer.compare(this.inputs[0].prevTxId, Buffer.alloc(32)) !== 0
      && this.outputs.length >= 2 && this.outputs[0].isEmpty()
  }
}
