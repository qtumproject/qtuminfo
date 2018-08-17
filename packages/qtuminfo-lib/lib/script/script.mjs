import util from 'util'
import secp256k1 from 'secp256k1'
import {BufferReader, BufferWriter} from '..'
import Opcode from './opcode'

const types = {
  UNKNOWN: 'Unknown',
  PUBKEY_OUT: 'Pay to public key',
  PUBKEY_IN: 'Spend from public key',
  PUBKEYHASH_OUT: 'Pay to public key hash',
  PUBKEYHASH_IN: 'Spend from public key hash',
  SCRIPT_OUT: 'Pay to script hash',
  SCRIPT_IN: 'Spend from script hash',
  MULTISIG_OUT: 'Pay to multisig',
  MULTISIG_IN: 'Spend from multisig',
  DATA_OUT: 'Data push',
  WITNESS_V0_KEYHASH: 'Pay to witness public key hash',
  WITNESS_V0_SCRIPTHASH: 'Pay to witness script hash',
  WITNESS_IN: 'Spend from witness',
  CONTRACT_CREATE: 'Contract create',
  CONTRACT_CALL: 'Contract call',
  CONTRACT_SPEND: 'Spend from contract'
}

const outputIdentifiers = {
  PUBKEY_OUT: 'isPublicKeyOut',
  PUBKEYHASH_OUT: 'isPublicKeyHashOut',
  MULTISIG_OUT: 'isMultisigOut',
  SCRIPTHASH_OUT: 'isScriptHashOut',
  DATA_OUT: 'isDataOut',
  WITNESS_V0_KEYHASH: 'isWitnessKeyHashOut',
  WITNESS_V0_SCRIPTHASH: 'isWitnessScriptHashOut',
  CONTRACT_CREATE: 'isContractCreate',
  CONTRACT_CALL: 'isContractCall'
}
const inputIdentifiers = {
  PUBKEY_IN: 'isPublicKeyIn',
  PUBKEYHASH_IN: 'isPublicKeyHashIn',
  MULTISIG_IN: 'isMultisigIn',
  SCRIPTHASH_IN: 'isScriptHashIn',
  WITNESS_IN: 'isWitnessIn',
  CONTRACT_SPEND: 'isContractSpend'
}

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

  static fromBuffer(buffer) {
    if (buffer[0] === Opcode.OP_RETURN) {
      let data = buffer.slice(1)
      return new Script([
        {code: Opcode.OP_RETURN},
        ...data.length ? [{buffer: data}] : []
      ])
    }
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
    return new Script(chunks)
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    if (this.isDataOut()) {
      writer.writeUInt8(Opcode.OP_RETURN)
      if (this.chunks.length === 2) {
        writer.write(this.chunks[1].buffer)
      }
      return
    }
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
    if (['OP_CREATE', 'OP_CALL'].includes(chunks[chunks.length - 1])) {
      for (let i = 0; i < 3; ++i) {
        if (/^OP_\d+$/.test(chunks[i])) {
          chunks[i] = chunks[i].slice(3)
        } else {
          chunks[i] = Number.parseInt(
            Buffer.from(chunks[i], 'hex')
              .reverse()
              .toString('hex'),
            16
          )
        }
      }
    }
    return chunks.join(' ')
  }

  [util.inspect.custom]() {
    return `<Script ${this.toString()}>`
  }

  isPublicKeyOut() {
    return this.chunks.length === 2
      && this.chunks[0].buffer && secp256k1.publicKeyVerify(this.chunks[0].buffer)
      && this.chunks[1].code === Opcode.OP_CHECKSIG
  }

  isPublicKeyIn() {
    return this.chunks.length === 1
      && this.chunks[0].buffer && this.chunks[0].buffer[0] === 0x30
  }

  isPublicKeyHashOut() {
    return this.chunks.length === 5
      && this.chunks[0].code === Opcode.OP_DUP
      && this.chunks[1].code === Opcode.OP_HASH160
      && this.chunks[2].buffer && this.chunks[2].buffer.length === 20
      && this.chunks[3].code === Opcode.OP_EQUALVERIFY
      && this.chunks[4].code === Opcode.OP_CHECKSIG
  }

  isPublicKeyHashIn() {
    return this.chunks.length === 2
      && this.chunks[0].buffer && this.chunks[0].buffer[0] === 0x30
      && this.chunks[1].buffer && secp256k1.publicKeyVerify(this.chunks[1].buffer)
  }

  isScriptHashOut() {
    return this.chunks.length === 3
      && this.chunks[0].code === Opcode.OP_HASH160
      && this.chunks[1].buffer && this.chunks[1].buffer.length === 20
      && this.chunks[2].code === Opcode.OP_EQUAL
  }

  isScriptHashIn() {
    if (this.chunks.length <= 1) {
      return false
    }
    let redeemBuffer = this.chunks[this.chunks.length - 1]
    if (!redeemBuffer) {
      return false
    }
    let redeemScript = Script.fromBuffer(redeemBuffer)
    return redeemScript.isStandard()
  }

  isMultisigOut() {
    return this.chunks.length > 3 && new Opcode(this.chunks[0].code).isSmallInt()
      && this.chunks.slice(1, -2).every(chunk => chunk.buffer)
      && new Opcode(this.chunks[this.chunks.length - 2].code).isSmallInt()
      && this.chunks[this.chunks.length - 1].code === Opcode.OP_CHECKMULTISIG
  }

  isMultisigIn() {
    return this.chunks.length >= 2 && this.chunks[0].code === Opcode.OP_0
      && this.chunks.slice(1).every(chunk => chunk.buffer && isDER(chunk.buffer))
  }

  isDataOut() {
    return this.chunks.length >= 1 && this.chunks[0].code === Opcode.OP_RETURN
      && (
        this.chunks.length === 1
        || this.chunks.length === 2 && this.chunks[1].buffer
      )
  }

  isWitnessKeyHashOut() {
    return this.chunks.length === 2 && this.chunks[0].code === Opcode.OP_0
      && this.chunks[1].buffer && this.chunks[1].buffer.length === 20
  }

  isWitnessScriptHashOut() {
    return this.chunks.length === 2 && this.chunks[0].code === Opcode.OP_0
      && this.chunks[1].buffer && this.chunks[1].buffer.length === 32
  }

  isWitnessIn() {
    return this.chunks.length === 1 && this.chunks[0].code <= 0x16
      && this.chunks[0].buffer.length >= 2 && this.chunks[0].buffer.length <= 40
  }

  isContractCreate() {
    return this.chunks.length === 5 && this.chunks[4].code === Opcode.OP_CREATE
  }

  isContractCall() {
    return this.chunks.length === 6 && this.chunks[5].code === Opcode.OP_CALL
  }

  isContractSpend() {
    return this.chunks.length === 1 && this.chunks[0].code === Opcode.OP_SPEND
  }

  get type() {
    if (this._type) {
      return this._type
    }
    if (this._isOutput) {
      return this._classifyOutput()
    } else if (this._isInput) {
      return this._classifyOutput()
    } else {
      let outputType = this._classifyOutput()
      this._type = outputType === types.UNKNOWN ? this._classifyInput() : outputType
    }
    return this._type
  }

  _classifyOutput() {
    for (let [type, method] of Object.entries(outputIdentifiers)) {
      if (this[method]()) {
        return types[type]
      }
    }
    return types.UNKNOWN
  }

  _classifyInput() {
    for (let [type, method] of Object.entries(inputIdentifiers)) {
      if (this[method]()) {
        return types[type]
      }
    }
    return types.UNKNOWN
  }

  isStandard() {
    return this.type !== types.UNKNOWN
  }

  isEmpty() {
    return this.chunks.length === 0
  }
}

function isDER(buffer) {
  if (buffer.length < 9 || buffer.length > 73) {
    return false
  } else if (buffer[0] !== 0x30 || buffer[1] !== buffer.length - 3) {
    return false
  }
  let lengthR = buffer[3]
  if (lengthR + 5 >= buffer.length) {
    return false
  }
  let lengthS = buffer[lengthR + 5]
  if (lengthR + lengthS + 7 !== buffer.length) {
    return false
  }
  let R = buffer.slice(4)
  if (buffer[2] !== 2 || lengthR === 0 || R[0] & 0x80) {
    return false
  } else if (lengthR > 1 && R[0] === 0 && !(R[1] & 0x80)) {
    return false
  }
  let S = buffer.slice(lengthR + 6)
  if (buffer[lengthR + 4] !== 2 || lengthS === 0 || S[0] & 0x80) {
    return false
  } else if (lengthS > 1 && S[0] === 0 && !(S[1] & 0x80)) {
    return false
  }
  return true
}

Object.assign(Script, types)
