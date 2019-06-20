import secp256k1 from 'secp256k1'
import Opcode from './opcode'
import Script, {InvalidScriptError} from '.'
import OutputScript from './output'

const types = {
  UNKNOWN: 'nonstandard',
  COINBASE: 'coinbase',
  PUBKEY: 'pubkey',
  PUBKEYHASH: 'pubkeyhash',
  SCRIPTHASH: 'scripthash',
  MULTISIG: 'multisig',
  WRAPPED_WITNESS_V0_KEYHASH: 'scripthash(witness_v0_keyhash)',
  WRAPPED_WITNESS_V0_SCRIPTHASH: 'scripthash(witness_v0_scripthash)',
  WITNESS_V0: 'witness_v0',
  CONTRACT_SPEND: 'contract'
}

export default class InputScript extends Script {
  constructor(chunks, witness) {
    super(chunks)
    this.witness = witness
  }

  static fromBuffer(buffer, witness, {isCoinbase = false} = {}) {
    if (isCoinbase) {
      return new CoinbaseScript([{buffer}], witness)
    }
    let chunks = Script.parseBuffer(buffer)
    for (const Class of [
      PublicKeyInputScript,
      PublicKeyHashInputScript,
      ScriptHashInputScript,
      MultisigInputScript,
      WrappedWitnessV0PublicKeyHashInputScript,
      WrappedWitnessV0ScriptHashInputScript,
      WitnessV0InputScript,
      ContractSpendScript
    ]) {
      if (Class.isValid(chunks, witness)) {
        return new Class(chunks, witness)
      }
    }
    return new InputScript(chunks, witness)
  }

  get type() {
    for (const [Class, typeString] of [
      [CoinbaseScript, types.COINBASE],
      [PublicKeyInputScript, types.PUBKEY],
      [PublicKeyHashInputScript, types.PUBKEYHASH],
      [ScriptHashInputScript, types.SCRIPTHASH],
      [MultisigInputScript, types.MULTISIG],
      [WrappedWitnessV0PublicKeyHashInputScript, types.WRAPPED_WITNESS_V0_KEYHASH],
      [WrappedWitnessV0ScriptHashInputScript, types.WRAPPED_WITNESS_V0_SCRIPTHASH],
      [WitnessV0InputScript, types.WITNESS_V0],
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

export class CoinbaseScript extends InputScript {
  constructor(chunks, witness) {
    super(chunks, witness)
    this.buffer = chunks[0].buffer
  }

  toBufferWriter(writer) {
    writer.write(this.buffer)
  }
}

export class PublicKeyInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 1 && chunks[0].buffer && isDER(chunks[0].buffer)
  }
}

export class PublicKeyHashInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 2
      && chunks[0].buffer && isDER(chunks[0].buffer)
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
    try {
      let redeemScript = OutputScript.fromBuffer(redeemBuffer)
      return redeemScript.isStandard()
    } catch (err) {
      if (err instanceof InvalidScriptError) {
        return false
      } else {
        throw err
      }
    }
  }
}

export class MultisigInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length >= 2 && chunks[0].code === Opcode.OP_0
      && chunks.slice(1).every(chunk => chunk.buffer && isDER(chunk.buffer))
  }
}

export class WrappedWitnessV0PublicKeyHashInputScript extends InputScript {
  static isValid(chunks, witness) {
    if (chunks.length !== 1 || witness.length !== 2) {
      return false
    }
    let redeemBuffer = chunks[0].buffer
    if (!redeemBuffer) {
      return false
    }
    try {
      let redeemScript = OutputScript.fromBuffer(redeemBuffer)
      return redeemScript.type === OutputScript.WITNESS_V0_KEYHASH
    } catch (err) {
      if (err instanceof InvalidScriptError) {
        return false
      } else {
        throw err
      }
    }
  }
}

export class WrappedWitnessV0ScriptHashInputScript extends InputScript {
  static isValid(chunks, witness) {
    if (chunks.length !== 1 || witness.length === 0) {
      return false
    }
    let redeemBuffer = chunks[0].buffer
    if (!redeemBuffer) {
      return false
    }
    try {
      let redeemScript = OutputScript.fromBuffer(redeemBuffer)
      return redeemScript.type === OutputScript.WITNESS_V0_SCRIPTHASH
    } catch (err) {
      if (err instanceof InvalidScriptError) {
        return false
      } else {
        throw err
      }
    }
  }
}

export class WitnessV0InputScript extends InputScript {
  static isValid(chunks, witness) {
    return chunks.length === 0 && witness.length !== 0
  }
}

export class ContractSpendScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 1 && chunks[0].code === Opcode.OP_SPEND
  }
}
