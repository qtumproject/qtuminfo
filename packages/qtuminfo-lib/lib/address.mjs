import util from 'util'
import {
  Hash,
  Base58Check, InvalidBase58Error, InvalidBase58ChecksumError,
  SegwitAddress, InvalidSegwitAddressError,
  Script
} from '.'

const types = {
  PAY_TO_PUBLIC_KEY: 'pubkey',
  PAY_TO_PUBLIC_KEY_HASH: 'pubkeyhash',
  PAY_TO_SCRIPT_HASH: 'scripthash',
  PAY_TO_WITNESS_KEY_HASH: 'witness_v0_keyhash',
  PAY_TO_WITNESS_SCRIPT_HASH: 'witness_v0_scripthash',
  CONTRACT_CREATE: 'create',
  CONTRACT_CALL: 'call',
  CONTRACT: 'contract'
}

export default class Address {
  constructor({type, data, chain}) {
    this.type = type
    this.data = data
    this.chain = chain
  }

  get [Symbol.toStringTag]() {
    return 'Address'
  }

  static fromScript(script, chain, transactionId, outputIndex) {
    script._isOutput = true
    switch (script.type) {
    case Script.PUBKEY_OUT:
      return new Address({
        type: types.PAY_TO_PUBLIC_KEY,
        data: Hash.sha256ripemd160(script.chunks[0].buffer),
        chain
      })
    case Script.PUBKEYHASH_OUT:
      return new Address({
        type: types.PAY_TO_PUBLIC_KEY_HASH,
        data: script.chunks[2].buffer,
        chain
      })
    case Script.SCRIPTHASH_OUT:
      return new Address({
        type: types.PAY_TO_SCRIPT_HASH,
        data: script.chunks[1].buffer,
        chain
      })
    case Script.WITNESS_V0_KEYHASH:
      return new Address({
        type: types.PAY_TO_WITNESS_KEY_HASH,
        data: script.chunks[1].buffer,
        chain
      })
    case Script.WITNESS_V0_SCRIPTHASH:
      return new Address({
        type: types.PAY_TO_WITNESS_SCRIPT_HASH,
        data: script.chunks[1].buffer,
        chain
      })
    case Script.CONTRACT_CREATE:
      return new Address({
        type: types.CONTRACT_CREATE,
        data: Hash.sha256ripemd160(
          Buffer.concat([Buffer.from(transactionId).reverse(), getUInt32LEBuffer(outputIndex)])
        ),
        chain
      })
    case Script.CONTRACT_CALL:
      return new Address({
        type: types.CONTRACT_CALL,
        data: script.chunks[4].buffer,
        chain
      })
    }
  }

  static fromString(string, chain) {
    if (/^[0-9a-f]{40}$/.test(string)) {
      return new Address({
        type: types.CONTRACT,
        data: Buffer.from(string, 'hex'),
        chain
      })
    }
    try {
      let result = Base58Check.decode(string)
      if (result.length === 21) {
        if (result[0] === chain.pubkeyhash) {
          return new Address({
            type: types.PAY_TO_PUBLIC_KEY_HASH,
            data: result.slice(1),
            chain
          })
        } else if (result[0] === chain.scripthash) {
          return new Address({
            type: types.PAY_TO_SCRIPT_HASH,
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
            type: types.PAY_TO_WITNESS_KEY_HASH,
            data: program,
            chain
          })
        } else if (program.length === 32) {
          return new Address({
            type: types.PAY_TO_WITNESS_SCRIPT_HASH,
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
    case types.PAY_TO_PUBLIC_KEY:
    case types.PAY_TO_PUBLIC_KEY_HASH:
      return Base58Check.encode(Buffer.from([this.chain.pubkeyhash, ...this.data]))
    case types.PAY_TO_SCRIPT_HASH:
      return Base58Check.encode(Buffer.from([this.chain.scripthash, ...this.data]))
    case types.PAY_TO_WITNESS_KEY_HASH:
    case types.PAY_TO_WITNESS_SCRIPT_HASH:
      return SegwitAddress.encode(this.chain.witnesshrp, 0, this.data)
    case types.CONTRACT:
    case types.CONTRACT_CREATE:
    case types.CONTRACT_CALL:
      return this.data.toString('hex')
    }
  }

  [util.inspect.custom]() {
    return `<Address: ${this.toString()}, type: ${this.type}>`
  }
}

Object.assign(Address, types)

function getUInt32LEBuffer(n) {
  let buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(n)
  return buffer
}
