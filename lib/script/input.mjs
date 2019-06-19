import secp256k1 from 'secp256k1'
import Opcode from './opcode'
import Script from '.'
import OutputScript from './output'

const types = {
  UNKNOWN: 'nonstandard',
  COINBASE: 'coinbase',
  PUBKEY_IN: 'pubkey',
  PUBKEYHASH_IN: 'pubkeyhash',
  SCRIPTHASH_IN: 'scripthash',
  MULTISIG_IN: 'multisig',
  WITNESS_IN: 'witness',
  CONTRACT_SPEND: 'contract'
}

export default class InputScript extends Script {
  static fromBuffer(buffer, {isCoinbase = false} = {}) {
    if (isCoinbase) {
      return new CoinbaseScript([{buffer}])
    }
    let chunks = Script.parseBuffer(buffer)
    for (const Class of [
      PublicKeyInputScript,
      PublicKeyHashInputScript,
      ScriptHashInputScript,
      MultisigInputScript,
      WitnessInputScript,
      ContractSpendScript
    ]) {
      if (Class.isValid(chunks)) {
        return new Class(chunks)
      }
    }
    return new InputScript(chunks)
  }

  get type() {
    for (const [Class, typeString] of [
      [CoinbaseScript, types.COINBASE],
      [PublicKeyInputScript, types.PUBKEY_IN],
      [PublicKeyHashInputScript, types.PUBKEYHASH_IN],
      [ScriptHashInputScript, types.SCRIPTHASH_IN],
      [MultisigInputScript, types.MULTISIG_IN],
      [WitnessInputScript, types.WITNESS_IN],
      [ContractSpendScript, types.CONTRACT_SPEND]
    ]) {
      if (this instanceof Class) {
        return typeString
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

export class CoinbaseScript extends InputScript {
  constructor(chunks) {
    super(chunks)
    this.buffer = chunks[0].buffer
  }

  toBufferWriter(writer) {
    writer.write(this.buffer)
  }
}

export class PublicKeyInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 1
      && chunks[0].buffer && chunks[0].buffer[0] === 0x30
  }
}

export class PublicKeyHashInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 2
      && chunks[0].buffer && chunks[0].buffer[0] === 0x30
      && chunks[1].buffer && secp256k1.publicKeyVerify(chunks[1].buffer)
  }
}

export class ScriptHashInputScript extends InputScript {
  static isValid(chunks) {
    if (chunks.length <= 1) {
      return false
    }
    let redeemBuffer = chunks[chunks.length - 1].buffer
    if (!redeemBuffer) {
      return false
    }
    let redeemScript = OutputScript.fromBuffer(redeemBuffer)
    return redeemScript.isStandard()
  }
}

export class MultisigInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length >= 2 && chunks[0].code === Opcode.OP_0
      && chunks.slice(1).every(chunk => chunk.buffer && isDER(chunk.buffer))
  }
}

export class WitnessInputScript extends InputScript {
  static isValid(chunks) {
    if (chunks.length === 0) {
      return true
    }
    if (chunks.length > 1) {
      return false
    }
    let redeemBuffer = chunks[chunks.length - 1].buffer
    if (!redeemBuffer) {
      return false
    }
    let redeemScript = OutputScript.fromBuffer(redeemBuffer)
    return redeemScript.isStandard()
  }
}

export class ContractSpendScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 1 && chunks[0].code === Opcode.OP_SPEND
  }
}
