import Opcode from './opcode'
import Script from '.'
import OutputScript from './output'

const TYPES = {
  UNKNOWN: 'nonstandard',
  COINBASE: 'coinbase',
  PUBKEY: 'pubkey',
  PUBKEYHASH: 'pubkeyhash',
  SCRIPTHASH: 'scripthash',
  SCRIPTHASH_WRAP_MULTISIG: 'scripthash(multisig)',
  MULTISIG: 'multisig',
  SCRIPTHASH_WRAP_WITNESS_V0_KEYHASH: 'scripthash(witness_v0_keyhash)',
  SCRIPTHASH_WRAP_WITNESS_V0_SCRIPTHASH: 'scripthash(witness_v0_scripthash)',
  SCRIPTHASH_WRAP_WITNESS_V0_SCRIPTHASH_WRAP_MULTISIG: 'scripthash(witness_v0_scripthash(multisig))',
  WITNESS_V0_KEYHASH: 'witness_v0_keyhash',
  WITNESS_V0_SCRIPTHASH: 'witness_v0_scripthash',
  CONTRACT_SPEND: 'contract'
}

export default class InputScript extends Script {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks)
    this.scriptPubKey = scriptPubKey
    this.witness = witness
  }

  static fromBuffer(buffer, {scriptPubKey, witness = [], isCoinbase = false}) {
    if (isCoinbase) {
      return new CoinbaseScript([{buffer}], scriptPubKey, witness)
    }
    let chunks = Script.parseBuffer(buffer)
    if (scriptPubKey.type === OutputScript.UNKNOWN) {
      return new InputScript(chunks, scriptPubKey, witness)
    }
    if (ScriptHashInputScript.isValid(chunks, scriptPubKey, witness)) {
      return new ScriptHashInputScript(chunks, scriptPubKey, witness)
    }
    if (witness.length) {
      for (const Class of [
        WitnessV0PublicKeyHashInputScript,
        WitnessV0ScriptHashInputScript
      ]) {
        if (Class.isValid(chunks, scriptPubKey, witness)) {
          return new Class(chunks, scriptPubKey, witness)
        }
      }
    } else {
      for (const Class of [
        PublicKeyInputScript,
        PublicKeyHashInputScript,
        MultisigInputScript,
        ContractSpendScript
      ]) {
        if (Class.isValid(chunks, scriptPubKey)) {
          return new Class(chunks, scriptPubKey, witness)
        }
      }
    }
    return new InputScript(chunks, scriptPubKey, witness)
  }

  get type() {
    return TYPES.UNKNOWN
  }

  isStandard() {
    return this.type !== TYPES.UNKNOWN
  }
}

Object.assign(InputScript, TYPES)

export class CoinbaseScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.buffer = chunks[0].buffer
  }

  toBufferWriter(writer) {
    writer.write(this.buffer)
  }

  get type() {
    return TYPES.COINBASE
  }
}

export class PublicKeyInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signature = chunks[0].buffer
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.PUBKEY
  }

  get type() {
    return TYPES.PUBKEY
  }
}

export class PublicKeyHashInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signature = chunks[0].buffer
    this.publicKey = chunks[1].buffer
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.PUBKEYHASH
  }

  get type() {
    return TYPES.PUBKEYHASH
  }
}

export class ScriptHashInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.redeemScript = OutputScript.fromBuffer(chunks[chunks.length - 1].buffer)
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.SCRIPTHASH
  }

  get type() {
    if (this.redeemScript.type === OutputScript.WITNESS_V0_SCRIPTHASH) {
      let witnessRedeemScript = OutputScript.fromBuffer(this.witness[this.witness.length - 1])
      if (witnessRedeemScript.isStandard()) {
        return `${TYPES.SCRIPTHASH}(${TYPES.WITNESS_V0_SCRIPTHASH}(${witnessRedeemScript.type}))`
      } else {
        return `${TYPES.SCRIPTHASH}(${TYPES.WITNESS_V0_SCRIPTHASH})`
      }
    }
    if (this.redeemScript.isStandard()) {
      return `${TYPES.SCRIPTHASH}(${this.redeemScript.type})`
    } else {
      return TYPES.SCRIPTHASH
    }
  }
}

export class MultisigInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signatures = chunks.slice(1).map(chunk => chunk.buffer)
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.MULTISIG
  }

  get type() {
    return TYPES.MULTISIG
  }
}

export class WitnessV0PublicKeyHashInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signature = witness[0]
    this.publicKey = witness[1]
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.WITNESS_V0_KEYHASH
  }

  get type() {
    return TYPES.WITNESS_V0_KEYHASH
  }
}

export class WitnessV0ScriptHashInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.redeemScript = OutputScript.fromBuffer(witness[witness.length - 1])
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.WITNESS_V0_SCRIPTHASH
  }

  get type() {
    if (this.redeemScript.isStandard()) {
      return `${TYPES.WITNESS_V0_SCRIPTHASH}(${this.redeemScript.type})`
    } else {
      return TYPES.WITNESS_V0_SCRIPTHASH
    }
  }
}

export class ContractSpendScript extends InputScript {
  static isValid(chunks, scriptPubKey) {
    return [OutputScript.EVM_CONTRACT_CALL, OutputScript.EVM_CONTRACT_CALL_SENDER, OutputScript.CONTRACT].includes(scriptPubKey.type)
      && chunks.length === 1 && chunks[0].code === Opcode.OP_SPEND
  }

  get type() {
    return TYPES.CONTRACT_SPEND
  }
}
