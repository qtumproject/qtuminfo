import util from 'util'
import {Hash, Base58Check, SegwitAddress, Script} from '.'

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

  static fromScript(script, chain, transactionId, outputIndex) {
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
    case Script.SCRIPT_OUT:
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
