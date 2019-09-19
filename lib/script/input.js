const Opcode = require('./opcode')
const Script = require('.')
const OutputScript = require('./output')

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

const SIGHASH_ALL = 1
const SIGHASH_NONE = 2
const SIGHASH_SINGLE = 3
const SIGHASH_ANYONECANPAY = 0x80

class InputScript extends Script {
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
        WitnessV0KeyHashInputScript,
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

function signature2String(signature) {
  let sighash = signature[signature.length - 1]
  let sighashString = ''
  if (sighash & SIGHASH_ANYONECANPAY) {
    if (sighash & SIGHASH_ALL) {
      sighashString = '[ALL|ANYONECANPAY]'
    } else if (sighash & SIGHASH_NONE) {
      sighashString = '[NONE|ANYONECANPAY]'
    } else if (sighash & SIGHASH_SINGLE) {
      sighashString = '[SINGLE|ANYONECANPAY]'
    }
  } else if (sighash & SIGHASH_ALL) {
    sighashString = '[ALL]'
  } else if (sighash & SIGHASH_NONE) {
    sighashString = '[NONE]'
  } else if (sighash & SIGHASH_SINGLE) {
    sighashString = '[SINGLE]'
  }
  return signature.slice(0, -1).toString('hex') + sighashString
}

class CoinbaseScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.buffer = chunks[0].buffer
    try {
      this.parsedChunks = Script.parseBuffer(this.buffer)
    } catch (err) {
      if (err instanceof Script.InvalidScriptError) {
        this.parsedChunks = null
      } else {
        throw err
      }
    }
  }

  toBufferWriter(writer) {
    writer.write(this.buffer)
  }

  toString() {
    if (this.parsedChunks) {
      let chunks = this.parsedChunks.map(({code, buffer}) => {
        if (buffer) {
          return buffer.toString('hex')
        } else if (code in Opcode.reverseMap) {
          return Opcode.reverseMap[code]
        } else {
          return code
        }
      })
      let code = new Opcode(this.parsedChunks[0].code)
      if (code.isSmallInt()) {
        chunks[0] = code.toSmallInt()
      } else if (this.parsedChunks[0].buffer.length <= 4) {
        chunks[0] = Number.parseInt(
          Buffer.from(this.parsedChunks[0].buffer, 'hex')
            .reverse()
            .toString('hex'),
          16
        )
      }
      return chunks.join(' ')
    } else {
      return `${this.buffer.toString('hex')} (invalid script)`
    }
  }

  get type() {
    return TYPES.COINBASE
  }
}

class PublicKeyInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signature = chunks[0].buffer
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.PUBKEY
  }

  toString() {
    return signature2String(this.signature)
  }

  get type() {
    return TYPES.PUBKEY
  }
}

class PublicKeyHashInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signature = chunks[0].buffer
    this.publicKey = chunks[1].buffer
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.PUBKEYHASH
  }

  toString() {
    return [signature2String(this.signature), this.publicKey.toString('hex')].join(' ')
  }

  get type() {
    return TYPES.PUBKEYHASH
  }
}

class ScriptHashInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.redeemScript = OutputScript.fromBuffer(chunks[chunks.length - 1].buffer)
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.SCRIPTHASH
  }

  toString() {
    let redeemString = `(${this.redeemScript.toString('hex')})`
    switch (this.redeemScript.type) {
    case OutputScript.PUBKEY:
      return [signature2String(this.chunks[0].buffer), redeemString].join(' ')
    case OutputScript.PUBKEYHASH:
      return [signature2String(this.chunks[0].buffer), this.chunks[1].buffer.toString('hex'), redeemString].join(' ')
    case OutputScript.MULTISIG:
      return [0, ...this.chunks.slice(1, -1).map(chunk => signature2String(chunk.buffer)), redeemString].join(' ')
    default:
      return [
        ...this.chunks.slice(0, -1).map(({code, buffer}) => {
          if (buffer) {
            return buffer.toString('hex')
          } else if (code in Opcode.reverseMap) {
            return Opcode.reverseMap[code]
          } else {
            return code
          }
        }),
        redeemString
      ].join(' ')
    }
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

class MultisigInputScript extends InputScript {
  constructor(chunks, scriptPubKey, witness) {
    super(chunks, scriptPubKey, witness)
    this.signatures = chunks.slice(1).map(chunk => chunk.buffer)
  }

  static isValid(chunks, scriptPubKey) {
    return scriptPubKey.type === OutputScript.MULTISIG
  }

  toString() {
    return [0, ...this.signatures.map(signature => signature2String(signature))].join(' ')
  }

  get type() {
    return TYPES.MULTISIG
  }
}

class WitnessV0KeyHashInputScript extends InputScript {
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

class WitnessV0ScriptHashInputScript extends InputScript {
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

class ContractSpendScript extends InputScript {
  static isValid(chunks, scriptPubKey) {
    return [OutputScript.EVM_CONTRACT_CALL, OutputScript.EVM_CONTRACT_CALL_SENDER, OutputScript.CONTRACT].includes(scriptPubKey.type)
      && chunks.length === 1 && chunks[0].code === Opcode.OP_SPEND
  }

  get type() {
    return TYPES.CONTRACT_SPEND
  }
}

exports = module.exports = InputScript
Object.assign(exports, TYPES, {
  CoinbaseScript,
  PublicKeyInputScript,
  PublicKeyHashInputScript,
  ScriptHashInputScript,
  MultisigInputScript,
  WitnessV0KeyHashInputScript,
  WitnessV0ScriptHashInputScript,
  ContractSpendScript
})
