import secp256k1 from 'secp256k1'
import Opcode from './opcode'
import Script from '.'

const types = {
  UNKNOWN: 'nonstandard',
  PUBKEY: 'pubkey',
  PUBKEYHASH: 'pubkeyhash',
  SCRIPTHASH: 'scripthash',
  MULTISIG: 'multisig',
  DATA: 'nulldata',
  WITNESS_V0_KEYHASH: 'witness_v0_keyhash',
  WITNESS_V0_SCRIPTHASH: 'witness_v0_scripthash',
  EVM_CONTRACT_CREATE: 'create',
  EVM_CONTRACT_CREATE_SENDER: 'create_sender',
  EVM_CONTRACT_CALL: 'call',
  EVM_CONTRACT_CALL_SENDER: 'call_sender',
  CONTRACT: 'call',
}

export default class OutputScript extends Script {
  static fromBuffer(buffer) {
    if (buffer[0] === Opcode.OP_RETURN) {
      return new DataOutputScript([{code: Opcode.OP_RETURN, buffer: buffer.slice(1)}])
    }
    let chunks = Script.parseBuffer(buffer)
    for (const Class of [
      PublicKeyOutputScript,
      PublicKeyHashOutputScript,
      ScriptHashOutputScript,
      MultisigOutputScript,
      WitnessV0KeyHashOutputScript,
      WitnessV0ScriptHashOut,
      EVMContractCreateScript,
      EVMContractCreateBySenderScript,
      EVMContractCallScript,
      EVMContractCallBySenderScript,
      ContractOutputScript
    ]) {
      if (Class.isValid(chunks)) {
        return new Class(chunks)
      }
    }
    return new OutputScript(chunks)
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
        chunks[i] = parseNumberChunk(chunks[i])
      }
    }
    return chunks.join(' ')
  }

  get type() {
    return types.UNKNOWN
  }

  isStandard() {
    return this.type !== types.UNKNOWN
  }
}

Object.assign(OutputScript, types)

function parseNumberChunk(chunk) {
  let code = new Opcode(chunk.code)
  if (code.isSmallInt()) {
    return code.toSmallInt()
  } else if (chunk.buffer) {
    return Number.parseInt(
      Buffer.from(chunk.buffer, 'hex')
        .reverse()
        .toString('hex'),
      16
    )
  }
}

function buildNumberChunk(n) {
  if (n <= 0xff) {
    return Script.buildChunk(Buffer.from([n]))
  } else if (n <= 0xffff) {
    return Script.buildChunk(Buffer.from([n & 0xff, n >> 8]))
  } else if (n <= 0xffffff) {
    return Script.buildChunk(Buffer.from([n & 0xff, n >> 8 & 0xff, n >> 16]))
  } else {
    return Script.buildChunk(Buffer.from([n & 0xff, n >> 8 & 0xff, n >> 16 & 0xff, n >> 24]))
  }
}

export class PublicKeyOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.publicKey = chunks[0].buffer
  }

  static build(publicKey) {
    return new PublicKeyOutputScript([
      Script.buildChunk(publicKey),
      {code: Opcode.OP_CHECKSIG}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 2
      && chunks[0].buffer && secp256k1.publicKeyVerify(chunks[0].buffer)
      && chunks[1].code === Opcode.OP_CHECKSIG
  }

  get type() {
    return types.PUBKEY
  }
}

export class PublicKeyHashOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.publicKeyHash = chunks[2].buffer
  }

  static build(publicKeyHash) {
    return new PublicKeyHashOutputScript([
      {code: Opcode.OP_DUP},
      {code: Opcode.OP_HASH160},
      Script.buildChunk(publicKeyHash),
      {code: Opcode.OP_EQUALVERIFY},
      {code: Opcode.OP_CHECKSIG}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 5
      && chunks[0].code === Opcode.OP_DUP
      && chunks[1].code === Opcode.OP_HASH160
      && chunks[2].buffer && chunks[2].buffer.length === 20
      && chunks[3].code === Opcode.OP_EQUALVERIFY
      && chunks[4].code === Opcode.OP_CHECKSIG
  }

  get type() {
    return types.PUBKEYHASH
  }
}

export class ScriptHashOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.scriptHash = chunks[1].buffer
  }

  static build(scriptHash) {
    return new ScriptHashOutputScript([
      {code: Opcode.OP_HASH160},
      Script.buildChunk(scriptHash),
      {code: Opcode.OP_CHECKSIG}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 3
      && chunks[0].code === Opcode.OP_HASH160
      && chunks[1].buffer && chunks[1].buffer.length === 20
      && chunks[2].code === Opcode.OP_EQUAL
  }

  get type() {
    return types.SCRIPTHASH
  }
}

export class MultisigOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.publicKeys = chunks.slice(1, -2).map(chunk => chunk.buffer)
    this.signaturesRequired = new Opcode(chunks[0].code).toSmallInt()
  }

  static build(publicKeys, signaturesRequired) {
    return new MultisigOutputScript([
      {code: Opcode[`OP_${signaturesRequired}`]},
      ...this.publicKeys.map(Script.buildChunk),
      {code: Opcode[`OP_${this.publicKeys.length}`]},
      {code: Opcode.OP_CHECKMULTISIG}
    ])
  }

  static isValid(chunks) {
    return chunks.length > 3 && new Opcode(chunks[0].code).isSmallInt()
      && chunks.slice(1, -2).every(chunk => chunk.buffer && secp256k1.publicKeyVerify(chunk.buffer))
      && new Opcode(chunks[chunks.length - 2].code).toSmallInt() === chunks.length - 3
      && chunks[chunks.length - 1].code === Opcode.OP_CHECKMULTISIG
  }

  get type() {
    return types.MULTISIG
  }
}

export class DataOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.buffer = chunks[0].buffer
  }

  static build(buffer) {
    return new DataOutputScript([{code: Opcode.OP_RETURN, buffer}])
  }

  toBufferWriter(writer) {
    writer.writeUInt8(Opcode.OP_RETURN)
    writer.write(this.buffer)
  }

  get type() {
    return types.DATA
  }
}

export class WitnessV0KeyHashOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.publicKeyHash = chunks[1].buffer
  }

  static build(publicKeyHash) {
    return new WitnessV0KeyHashOutputScript([
      {code: Opcode.OP_0},
      Script.buildChunk(publicKeyHash)
    ])
  }

  static isValid(chunks) {
    return chunks.length === 2 && chunks[0].code === Opcode.OP_0
      && chunks[1].buffer && chunks[1].buffer.length === 20
  }

  get type() {
    return types.WITNESS_V0_KEYHASH
  }
}

export class WitnessV0ScriptHashOut extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.scriptHash = chunks[1].buffer
  }

  static build(scriptHash) {
    return new WitnessV0ScriptHashOut([
      {code: Opcode.OP_0},
      Script.buildChunk(scriptHash)
    ])
  }

  static isValid(chunks) {
    return chunks.length === 2 && chunks[0].code === Opcode.OP_0
      && chunks[1].buffer && chunks[1].buffer.length === 32
  }

  get type() {
    return types.WITNESS_V0_SCRIPTHASH
  }
}

export class EVMContractCreateScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.gasLimit = parseNumberChunk(chunks[1])
    this.gasPrice = parseNumberChunk(chunks[2])
    this.byteCode = chunks[3].buffer
  }

  static build({gasLimit, gasPrice, byteCode}) {
    return new EVMContractCreateScript([
      buildNumberChunk(4),
      buildNumberChunk(gasLimit),
      buildNumberChunk(gasPrice),
      Script.buildChunk(byteCode),
      {code: Opcode.OP_CREATE}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 5
      && parseNumberChunk(chunks[0]) === 4
      && chunks[4].code === Opcode.OP_CREATE
  }

  toString() {
    return [
      4,
      this.gasLimit,
      this.gasPrice,
      this.byteCode.toString('hex'),
      'OP_CREATE'
    ].join(' ')
  }

  get type() {
    return types.EVM_CONTRACT_CREATE
  }
}

export class EVMContractCreateBySenderScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.addressType = parseNumberChunk(chunks[0])
    this.addressData = chunks[1].buffer
    this.signature = chunks[2].buffer
    this.gasLimit = parseNumberChunk(chunks[5])
    this.gasPrice = parseNumberChunk(chunks[6])
    this.byteCode = chunks[7].buffer
  }

  static build({addressType, addressData, signature, gasLimit, gasPrice, byteCode}) {
    return new EVMContractCreateBySenderScript([
      buildNumberChunk(addressType),
      Script.buildChunk(addressData),
      Script.buildChunk(signature),
      {code: Opcode.OP_SENDER},
      buildNumberChunk(4),
      buildNumberChunk(gasLimit),
      buildNumberChunk(gasPrice),
      Script.buildChunk(byteCode),
      {code: Opcode.OP_CREATE}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 9
      && chunks[3].code === Opcode.OP_SENDER
      && parseNumberChunk(chunks[4]) === 4
      && chunks[8].code === Opcode.OP_CREATE
  }

  toString() {
    return [
      this.addressType,
      this.addressData.toString('hex'),
      this.signature.toString('hex'),
      'OP_SENDER',
      4,
      this.gasLimit,
      this.gasPrice,
      this.byteCode.toString('hex'),
      'OP_CREATE'
    ].join(' ')
  }

  get type() {
    return types.EVM_CONTRACT_CREATE_SENDER
  }
}

export class EVMContractCallScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.gasLimit = parseNumberChunk(chunks[1])
    this.gasPrice = parseNumberChunk(chunks[2])
    this.byteCode = chunks[3].buffer
    this.contract = chunks[4].buffer
  }

  static build({gasLimit, gasPrice, byteCode, contract}) {
    return new EVMContractCallScript([
      buildNumberChunk(4),
      buildNumberChunk(gasLimit),
      buildNumberChunk(gasPrice),
      Script.buildChunk(byteCode),
      Script.buildChunk(contract),
      {code: Opcode.OP_CALL}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 6
      && parseNumberChunk(chunks[0]) === 4
      && chunks[5].code === Opcode.OP_CALL
  }

  toString() {
    return [
      4,
      this.gasLimit,
      this.gasPrice,
      this.byteCode.toString('hex'),
      this.contract.toString('hex'),
      'OP_CALL'
    ].join(' ')
  }

  get type() {
    return types.EVM_CONTRACT_CALL
  }
}

export class EVMContractCallBySenderScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.addressType = parseNumberChunk(chunks[0])
    this.addressData = chunks[1].buffer
    this.signature = chunks[2].buffer
    this.gasLimit = parseNumberChunk(chunks[5])
    this.gasPrice = parseNumberChunk(chunks[6])
    this.byteCode = chunks[7].buffer
    this.contract = chunks[8].buffer
  }

  static build({addressType, addressData, signature, gasLimit, gasPrice, byteCode, contract}) {
    return new EVMContractCallBySenderScript([
      buildNumberChunk(addressType),
      Script.buildChunk(addressData),
      Script.buildChunk(signature),
      {code: Opcode.OP_SENDER},
      buildNumberChunk(4),
      buildNumberChunk(gasLimit),
      buildNumberChunk(gasPrice),
      Script.buildChunk(byteCode),
      Script.buildChunk(contract),
      {code: Opcode.OP_CREATE}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 10
      && chunks[3].code === Opcode.OP_SENDER
      && parseNumberChunk(chunks[4]) === 4
      && chunks[9].code === Opcode.OP_CALL
  }

  toString() {
    return [
      this.addressType,
      this.addressData.toString('hex'),
      this.signature.toString('hex'),
      'OP_SENDER',
      4,
      this.gasLimit,
      this.gasPrice,
      this.byteCode.toString('hex'),
      this.contract.toString('hex'),
      'OP_CALL'
    ].join(' ')
  }

  get type() {
    return types.EVM_CONTRACT_CALL_SENDER
  }
}

export class ContractOutputScript extends OutputScript {
  constructor(chunks) {
    super(chunks)
    this.contract = chunks[4].buffer
  }

  static build(contract) {
    return new EVMContractCallBySenderScript([
      buildNumberChunk(0),
      buildNumberChunk(0),
      buildNumberChunk(0),
      Script.buildChunk(Buffer.alloc(1)),
      {code: 20, buffer: contract},
      {code: Opcode.OP_CALL}
    ])
  }

  static isValid(chunks) {
    return chunks.length === 6
      && parseNumberChunk(chunks[0]) === 0
      && chunks[5].code === Opcode.OP_CALL
  }

  toString() {
    return [0, 0, 0, '00', this.contract.toString('hex'), 'OP_CALL'].join(' ')
  }

  get type() {
    return types.CONTRACT
  }
}
