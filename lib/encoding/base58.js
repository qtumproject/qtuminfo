const Hash = require('../crypto/hash')

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const ALPHABET_MAP = {}
for (let index = 0; index < ALPHABET.length; ++index) {
  ALPHABET_MAP[ALPHABET[index]] = index
}

class InvalidBase58Error extends Error {
  constructor(...args) {
    super(...args)
    Error.captureStackTrace(this, this.constructor)
  }

  get name() {
    return this.constructor.name
  }
}

class Base58 {
  static encode(buffer) {
    let result = []
    let n = 0n
    for (let x of buffer) {
      n = n << 8n | BigInt(x)
    }
    while (n > 0) {
      let r = n % 58n
      n /= 58n
      result.push(Number(r))
    }
    for (let i = 0; buffer[i] === 0; ++i) {
      result.push(0)
    }
    return result.reverse()
      .map(x => ALPHABET[x])
      .join('')
  }

  static decode(string) {
    if (string === '') {
      return Buffer.alloc(0)
    }
    let n = 0n
    for (let s of string) {
      if (!(s in ALPHABET_MAP)) {
        throw new InvalidBase58Error(string)
      }
      n = n * 58n + BigInt(ALPHABET_MAP[s])
    }
    let list = []
    while (n > 0) {
      list.push(Number(n & 0xffn))
      n >>= 8n
    }
    for (let i = 0; i < string.length && string[i] === ALPHABET[0]; ++i) {
      list.push(0)
    }
    return Buffer.from(list.reverse())
  }
}

class InvalidBase58ChecksumError extends Error {
  constructor(...args) {
    super(...args)
    Error.captureStackTrace(this, this.constructor)
  }

  get name() {
    return this.constructor.name
  }
}

class Base58Check {
  static encode(buffer) {
    let checkedBuffer = Buffer.alloc(buffer.length + 4)
    let hashBuffer = Hash.sha256sha256(buffer)
    buffer.copy(checkedBuffer)
    hashBuffer.copy(checkedBuffer, buffer.length)
    return Base58.encode(checkedBuffer)
  }

  static decode(string) {
    let buffer = Base58.decode(string)
    let data = buffer.slice(0, -4)
    let checksum = buffer.slice(-4)
    let hashBuffer = Hash.sha256sha256(data)
    if (Buffer.compare(hashBuffer.slice(0, 4), checksum) !== 0) {
      throw new InvalidBase58ChecksumError(string)
    }
    return data
  }
}

Object.assign(exports, {Base58, Base58Check, InvalidBase58Error, InvalidBase58ChecksumError})
