class BufferReader {
  #buffer = null

  constructor(buffer) {
    this.#buffer = buffer
  }

  get length() {
    return this.#buffer.length
  }

  get finished() {
    return this.#buffer.length === 0
  }

  read(length) {
    let buffer = this.#buffer.slice(0, length)
    this.#buffer = this.#buffer.slice(length)
    return buffer
  }

  readHexString(length) {
    return this.#buffer.read(length).toString('hex')
  }

  readAll() {
    let buffer = this.#buffer
    this.#buffer = Buffer.alloc(0)
    return buffer
  }

  readUInt8() {
    let value = this.#buffer.readUInt8(0)
    this.#buffer = this.#buffer.slice(1)
    return value
  }

  readUInt16LE() {
    let value = this.#buffer.readUInt16LE(0)
    this.#buffer = this.#buffer.slice(2)
    return value
  }

  readUInt16BE() {
    let value = this.#buffer.readUInt16BE(0)
    this.#buffer = this.#buffer.slice(2)
    return value
  }

  readUInt32LE() {
    let value = this.#buffer.readUInt32LE(0)
    this.#buffer = this.#buffer.slice(4)
    return value
  }

  readUInt32BE() {
    let value = this.#buffer.readUInt32BE(0)
    this.#buffer = this.#buffer.slice(4)
    return value
  }

  readInt32LE() {
    let value = this.#buffer.readInt32LE(0)
    this.#buffer = this.#buffer.slice(4)
    return value
  }

  readInt32BE() {
    let value = this.#buffer.readInt32BE(0)
    this.#buffer = this.#buffer.slice(4)
    return value
  }

  readUInt64LE() {
    let low = this.#buffer.readUInt32LE()
    let high = this.#buffer.readUInt32LE(4)
    let value = (BigInt(high) << 32n) + BigInt(low)
    this.#buffer = this.#buffer.slice(8)
    return value
  }

  readVarintNumber() {
    let first = this.readUInt8()
    switch (first) {
    case 0xfd:
      return this.readUInt16LE()
    case 0xfe:
      return this.readUInt32LE()
    case 0xff:
      return Number(this.readUInt64LE())
    default:
      return first
    }
  }

  readVarLengthBuffer() {
    let length = this.readVarintNumber()
    return this.read(length)
  }

  push(buffer) {
    this.#buffer = Buffer.concat([this.#buffer, buffer])
  }

  skip(offset) {
    this.#buffer = this.#buffer.slice(offset)
  }

  slice(...args) {
    return this.#buffer.slice(...args)
  }
}

module.exports = BufferReader
