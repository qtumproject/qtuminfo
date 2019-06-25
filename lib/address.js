const util = require('util')
const Hash = require('./crypto/hash')
const {Base58Check, InvalidBase58Error, InvalidBase58ChecksumError} = require('./encoding/base58')
const SegwitAddress = require('./encoding/segwit-address')
const {InvalidSegwitAddressError} = SegwitAddress
const OutputScript = require('./script/output')

const TYPES = {
  PAY_TO_PUBLIC_KEY_HASH: 'pubkeyhash',
  PAY_TO_SCRIPT_HASH: 'scripthash',
  PAY_TO_WITNESS_KEY_HASH: 'witness_v0_keyhash',
  PAY_TO_WITNESS_SCRIPT_HASH: 'witness_v0_scripthash',
  CONTRACT: 'contract',
  EVM_CONTRACT: 'evm_contract'
}

class Address {
  constructor({type, data, chain}) {
    this.type = type
    this.data = data
    this.chain = chain
  }

  get [Symbol.toStringTag]() {
    return 'Address'
  }

  static fromScript(script, chain, transactionId, outputIndex) {
    switch (script.type) {
    case OutputScript.PUBKEY:
      return new Address({
        type: TYPES.PAY_TO_PUBLIC_KEY_HASH,
        data: Hash.sha256ripemd160(script.publicKey),
        chain
      })
    case OutputScript.PUBKEYHASH:
      return new Address({
        type: TYPES.PAY_TO_PUBLIC_KEY_HASH,
        data: script.publicKeyHash,
        chain
      })
    case OutputScript.SCRIPTHASH:
      return new Address({
        type: TYPES.PAY_TO_SCRIPT_HASH,
        data: script.scriptHash,
        chain
      })
    case OutputScript.WITNESS_V0_KEYHASH:
      return new Address({
        type: TYPES.PAY_TO_WITNESS_KEY_HASH,
        data: script.publicKeyHash,
        chain
      })
    case OutputScript.WITNESS_V0_SCRIPTHASH:
      return new Address({
        type: TYPES.PAY_TO_WITNESS_SCRIPT_HASH,
        data: script.scriptHash,
        chain
      })
    case OutputScript.EVM_CONTRACT_CREATE:
    case OutputScript.EVM_CONTRACT_CREATE_SENDER:
      return new Address({
        type: TYPES.EVM_CONTRACT,
        data: Hash.sha256ripemd160(
          Buffer.concat([Buffer.from(transactionId).reverse(), getUInt32LEBuffer(outputIndex)])
        ),
        chain
      })
    case OutputScript.EVM_CONTRACT_CALL:
    case OutputScript.EVM_CONTRACT_CALL_SENDER:
      return new Address({
        type: TYPES.EVM_CONTRACT,
        data: script.contract,
        chain
      })
    case OutputScript.CONTRACT:
      return new Address({
        type: TYPES.CONTRACT,
        data: script.contract,
        chain
      })
    }
  }

  static fromString(string, chain) {
    if (/^[0-9a-f]{40}$/.test(string)) {
      return new Address({
        type: TYPES.CONTRACT,
        data: Buffer.from(string, 'hex'),
        chain
      })
    }
    try {
      let result = Base58Check.decode(string)
      if (result.length === 21) {
        if (result[0] === chain.pubkeyhash) {
          return new Address({
            type: TYPES.PAY_TO_PUBLIC_KEY_HASH,
            data: result.slice(1),
            chain
          })
        } else if (result[0] === chain.scripthash) {
          return new Address({
            type: TYPES.PAY_TO_SCRIPT_HASH,
            data: result.slice(1),
            chain
          })
        } else if (result[0] === chain.evm) {
          return new Address({
            type: TYPES.EVM_CONTRACT,
            data: result.slice(1),
            chain
          })
        }
      }
    } catch (err) {
      if (!(err instanceof InvalidBase58Error || err instanceof InvalidBase58ChecksumError)) {
        throw err
      }
    }
    try {
      let {hrp, version, program} = SegwitAddress.decode(string)
      if (hrp === chain.witnesshrp && version === 0) {
        if (program.length === 20) {
          return new Address({
            type: TYPES.PAY_TO_WITNESS_KEY_HASH,
            data: program,
            chain
          })
        } else if (program.length === 32) {
          return new Address({
            type: TYPES.PAY_TO_WITNESS_SCRIPT_HASH,
            data: program,
            chain
          })
        }
      }
    } catch (err) {
      if (!(err instanceof InvalidSegwitAddressError)) {
        throw err
      }
    }
  }

  toString() {
    switch (this.type) {
    case TYPES.PAY_TO_PUBLIC_KEY_HASH:
      return Base58Check.encode(Buffer.from([this.chain.pubkeyhash, ...this.data]))
    case TYPES.PAY_TO_SCRIPT_HASH:
      return Base58Check.encode(Buffer.from([this.chain.scripthash, ...this.data]))
    case TYPES.PAY_TO_WITNESS_KEY_HASH:
    case TYPES.PAY_TO_WITNESS_SCRIPT_HASH:
      return SegwitAddress.encode(this.chain.witnesshrp, 0, this.data)
    case TYPES.CONTRACT:
      return this.data.toString('hex')
    case TYPES.EVM_CONTRACT:
      return Base58Check.encode(Buffer.from([this.chain.evm, ...this.data]))
    }
  }

  [util.inspect.custom]() {
    return `<Address: ${this.toString()}, type: ${this.type}>`
  }
}

function getUInt32LEBuffer(n) {
  let buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(n)
  return buffer
}

exports = module.exports = Address
Object.assign(exports, TYPES)
