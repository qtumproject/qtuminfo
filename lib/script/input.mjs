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
    if (witness.length) {
      for (const Class of [
        WrappedWitnessV0PublicKeyHashInputScript,
        WrappedWitnessV0ScriptHashInputScript,
        WitnessV0InputScript,
      ]) {
        if (Class.isValid(chunks, witness)) {
          return new Class(chunks, witness)
        }
      }
    } else {
      for (const Class of [
        PublicKeyInputScript,
        PublicKeyHashInputScript,
        ScriptHashInputScript,
        MultisigInputScript,
        ContractSpendScript
      ]) {
        if (Class.isValid(chunks)) {
          return new Class(chunks, [])
        }
      }
    }
    return new InputScript(chunks, witness)
  }

  get type() {
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

  get type() {
    return types.COINBASE
  }
}

export class PublicKeyInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 1 && chunks[0].buffer && isDER(chunks[0].buffer)
  }

  get type() {
    return types.PUBKEY
  }
}

export class PublicKeyHashInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 2
      && chunks[0].buffer && isDER(chunks[0].buffer)
      && chunks[1].buffer && secp256k1.publicKeyVerify(chunks[1].buffer)
  }

  get type() {
    return types.PUBKEYHASH
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

  get type() {
    return types.SCRIPTHASH
  }
}

export class MultisigInputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length >= 2 && chunks[0].code === Opcode.OP_0
      && chunks.slice(1).every(chunk => chunk.buffer && isDER(chunk.buffer))
  }

  get type() {
    return types.MULTISIG
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

  get type() {
    return types.WRAPPED_WITNESS_V0_KEYHASH
  }
}

export class WrappedWitnessV0ScriptHashInputScript extends InputScript {
  static isValid(chunks) {
    if (chunks.length !== 1) {
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

  get type() {
    return types.WRAPPED_WITNESS_V0_SCRIPTHASH
  }
}

export class WitnessV0InputScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 0
  }

  get type() {
    return types.WITNESS_V0
  }
}

export class ContractSpendScript extends InputScript {
  static isValid(chunks) {
    return chunks.length === 1 && chunks[0].code === Opcode.OP_SPEND
  }

  get type() {
    return types.CONTRACT_SPEND
  }
}
