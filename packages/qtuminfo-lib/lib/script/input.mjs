import secp256k1 from 'secp256k1'
import Opcode from './opcode'
import Script from './script'
import OutputScript from './output'

const types = {
  UNKNOWN: 'Unknown',
  COINBASE: 'Coinbase',
  PUBKEY_IN: 'Spend from public key',
  PUBKEYHASH_IN: 'Spend from public key hash',
  SCRIPTHASH_IN: 'Spend from script hash',
  MULTISIG_IN: 'Spend from multisig',
  WITNESS_IN: 'Spend from witness',
  CONTRACT_SPEND: 'Spend from contract'
}

const inputIdentifiers = {
  COINBASE: 'isCoinbase',
  PUBKEY_IN: 'isPublicKeyIn',
  PUBKEYHASH_IN: 'isPublicKeyHashIn',
  MULTISIG_IN: 'isMultisigIn',
  SCRIPTHASH_IN: 'isScriptHashIn',
  WITNESS_IN: 'isWitnessIn',
  CONTRACT_SPEND: 'isContractSpend'
}

export default class InputScript extends Script {
  #isCoinbase = false

  constructor(chunks, {isCoinbase = false} = {}) {
    super(chunks)
    this.#isCoinbase = isCoinbase
  }

  static fromBuffer(buffer, {isCoinbase = false} = {}) {
    if (isCoinbase) {
      return new InputScript([{buffer}], {isCoinbase: true})
    } else {
      return new InputScript(Script.parseBuffer(buffer))
    }
  }

  toBufferWriter(writer) {
    if (this.#isCoinbase) {
      writer.write(this.chunks[0].buffer)
    } else {
      super.toBufferWriter(writer)
    }
  }

  isCoinbase() {
    return this.#isCoinbase
  }

  isPublicKeyIn() {
    return this.chunks.length === 1
      && this.chunks[0].buffer && this.chunks[0].buffer[0] === 0x30
  }

  isPublicKeyHashIn() {
    return this.chunks.length === 2
      && this.chunks[0].buffer && this.chunks[0].buffer[0] === 0x30
      && this.chunks[1].buffer && secp256k1.publicKeyVerify(this.chunks[1].buffer)
  }

  isScriptHashIn() {
    if (this.chunks.length <= 1) {
      return false
    }
    let redeemBuffer = this.chunks[this.chunks.length - 1].buffer
    if (!redeemBuffer) {
      return false
    }
    let redeemScript = OutputScript.fromBuffer(redeemBuffer)
    return redeemScript.isStandard()
  }

  isMultisigIn() {
    return this.chunks.length >= 2 && this.chunks[0].code === Opcode.OP_0
      && this.chunks.slice(1).every(chunk => chunk.buffer && isDER(chunk.buffer))
  }

  isWitnessIn() {
    if (this.chunks.length === 0) {
      return true
    }
    if (this.chunks.length > 1) {
      return false
    }
    let redeemBuffer = this.chunks[this.chunks.length - 1].buffer
    if (!redeemBuffer) {
      return false
    }
    let redeemScript = Script.fromBuffer(redeemBuffer, {isOutput: true})
    return redeemScript.isStandard()
  }

  isContractSpend() {
    return this.chunks.length === 1 && this.chunks[0].code === Opcode.OP_SPEND
  }

  get type() {
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

Object.assign(InputScript, types)
Object.assign(Script, types)
