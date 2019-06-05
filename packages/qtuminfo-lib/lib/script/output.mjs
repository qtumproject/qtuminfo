import secp256k1 from 'secp256k1'
import Opcode from './opcode'
import Script from './script'

const types = {
  UNKNOWN: 'Unknown',
  PUBKEY_OUT: 'Pay to public key',
  PUBKEYHASH_OUT: 'Pay to public key hash',
  SCRIPTHASH_OUT: 'Pay to script hash',
  MULTISIG_OUT: 'Pay to multisig',
  DATA_OUT: 'Data push',
  WITNESS_V0_KEYHASH: 'Pay to witness public key hash',
  WITNESS_V0_SCRIPTHASH: 'Pay to witness script hash',
  EVM_CONTRACT_CREATE: 'EVM contract create',
  EVM_CONTRACT_CALL: 'EVM contract call',
  EVM_CONTRACT_CREATE_SENDER: 'EVM contract create by sender',
  EVM_CONTRACT_CALL_SENDER: 'EVM contract call by sender',
  CONTRACT_OUT: 'Pay to contract',
}

const outputIdentifiers = {
  PUBKEY_OUT: 'isPublicKeyOut',
  PUBKEYHASH_OUT: 'isPublicKeyHashOut',
  MULTISIG_OUT: 'isMultisigOut',
  SCRIPTHASH_OUT: 'isScriptHashOut',
  DATA_OUT: 'isDataOut',
  WITNESS_V0_KEYHASH: 'isWitnessKeyHashOut',
  WITNESS_V0_SCRIPTHASH: 'isWitnessScriptHashOut',
  EVM_CONTRACT_CREATE: 'isEVMContractCreate',
  EVM_CONTRACT_CALL: 'isEVMContractCall',
  EVM_CONTRACT_CREATE_SENDER: 'isEVMContractCreateBySender',
  EVM_CONTRACT_CALL_SENDER: 'isEVMContractCallBySender',
  CONTRACT_OUT: 'isContractOut'
}

export default class OutputScript extends Script {
  static fromBuffer(buffer) {
    if (buffer[0] === Opcode.OP_RETURN) {
      let data = buffer.slice(1)
      return new OutputScript([
        {code: Opcode.OP_RETURN},
        ...data.length ? [{buffer: data}] : []
      ])
    } else {
      return new OutputScript(Script.parseBuffer(buffer))
    }
  }

  toBufferWriter(writer) {
    if (this.isDataOut()) {
      writer.writeUInt8(Opcode.OP_RETURN)
      if (this.chunks.length === 2) {
        writer.write(this.chunks[1].buffer)
      }
    } else {
      super.toBufferWriter(writer)
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
        chunks[i] = Script.parseNumberChunk(chunks[i])
      }
    }
    return chunks.join(' ')
  }

  isPublicKeyOut() {
    return this.chunks.length === 2
      && this.chunks[0].buffer && secp256k1.publicKeyVerify(this.chunks[0].buffer)
      && this.chunks[1].code === Opcode.OP_CHECKSIG
  }

  isPublicKeyHashOut() {
    return this.chunks.length === 5
      && this.chunks[0].code === Opcode.OP_DUP
      && this.chunks[1].code === Opcode.OP_HASH160
      && this.chunks[2].buffer && this.chunks[2].buffer.length === 20
      && this.chunks[3].code === Opcode.OP_EQUALVERIFY
      && this.chunks[4].code === Opcode.OP_CHECKSIG
  }

  isScriptHashOut() {
    return this.chunks.length === 3
      && this.chunks[0].code === Opcode.OP_HASH160
      && this.chunks[1].buffer && this.chunks[1].buffer.length === 20
      && this.chunks[2].code === Opcode.OP_EQUAL
  }

  isMultisigOut() {
    return this.chunks.length > 3 && new Opcode(this.chunks[0].code).isSmallInt()
      && this.chunks.slice(1, -2).every(chunk => chunk.buffer)
      && new Opcode(this.chunks[this.chunks.length - 2].code).isSmallInt()
      && this.chunks[this.chunks.length - 1].code === Opcode.OP_CHECKMULTISIG
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

  isEVMContractCreate() {
    return this.chunks.length === 5
      && (this.chunks[0].code === Opcode.OP_4 || this.chunks[0].buffer && this.chunks[0].buffer[0] === 4)
      && this.chunks[4].code === Opcode.OP_CREATE
  }

  isEVMContractCreateBySender() {
    return this.chunks.length === 9
      && this.chunks[3].code === Opcode.OP_SENDER
      && (this.chunks[4].code === Opcode.OP_4 || this.chunks[4].buffer && this.chunks[4].buffer[0] === 4)
      && this.chunks[8].code === Opcode.OP_CREATE
  }

  isEVMContractCall() {
    return this.chunks.length === 6
      && (this.chunks[0].code === Opcode.OP_4 || this.chunks[0].buffer && this.chunks[0].buffer[0] === 4)
      && this.chunks[5].code === Opcode.OP_CALL
  }

  isEVMContractCallBySender() {
    return this.chunks.length === 10
      && this.chunks[3].code === Opcode.OP_SENDER
      && (this.chunks[4].code === Opcode.OP_4 || this.chunks[4].buffer && this.chunks[4].buffer[0] === 4)
      && this.chunks[9].code === Opcode.OP_CALL
  }

  isContractOut() {
    return this.chunks.length === 6
      && this.chunks[0].buffer && this.chunks[0].buffer[0] === 0
      && this.chunks[5].code === Opcode.OP_CALL
  }

  get type() {
    for (let [type, method] of Object.entries(outputIdentifiers)) {
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

Object.assign(OutputScript, types)
Object.assign(Script, types)
