class BufferWriter {
  #buffer = []

  toBuffer() {
    return Buffer.concat(this.#buffer)
  }

  write(buffer) {
    this.#buffer.push(buffer)
  }

  writeHexString(string) {
    this.#buffer.push(Buffer.from(string, 'hex'))
  }

  writeUInt8(n) {
    let buffer = Buffer.alloc(1)
    buffer.writeUInt8(n, 0)
    this.write(buffer)
  }

  writeUInt16LE(n) {
    let buffer = Buffer.alloc(2)
    buffer.writeUInt16LE(n, 0)
    this.write(buffer)
  }

  writeUInt16BE(n) {
    let buffer = Buffer.alloc(2)
    buffer.writeUInt16BE(n, 0)
    this.write(buffer)
  }

  writeUInt32LE(n) {
    let buffer = Buffer.alloc(4)
    buffer.writeUInt32LE(n, 0)
    this.write(buffer)
  }

  writeUInt32BE(n) {
    let buffer = Buffer.alloc(4)
    buffer.writeUInt32BE(n, 0)
    this.write(buffer)
  }

  writeInt32LE(n) {
    let buffer = Buffer.alloc(4)
    buffer.writeInt32LE(n, 0)
    this.write(buffer)
  }

  writeInt32BE(n) {
    let buffer = Buffer.alloc(4)
    buffer.writeInt32BE(n, 0)
    this.write(buffer)
  }

  writeUInt64LE(n) {
    let buffer = Buffer.alloc(8)
    buffer.writeUInt32LE(Number(n & 0xffffffffn), 0)
    buffer.writeUInt32LE(Number(n >> 32n), 4)
    this.write(buffer)
  }

  writeVarintNumber(n) {
    if (n instanceof BigInt) {
      if (n > BigInt(0xffffffff)) {
        let buffer = Buffer.alloc(1 + 8)
        buffer.writeUInt8(0xff, 0)
        buffer.writeUInt64LE(n, 1)
        this.write(buffer)
        return
      }
      n = Number(n)
    }
    if (n < 0xfd) {
      let buffer = Buffer.alloc(1)
      buffer.writeUInt8(n, 0)
      this.write(buffer)
    } else if (n < 0x10000) {
      let buffer = Buffer.alloc(1 + 2)
      buffer.writeUInt8(0xfd, 0)
      buffer.writeUInt16LE(n, 1)
      this.write(buffer)
    } else if (n < 0x100000000) {
      let buffer = Buffer.alloc(1 + 4)
      buffer.writeUInt8(0xfe, 0)
      buffer.writeUInt32LE(n, 1)
      this.write(buffer)
    } else {
      let buffer = Buffer.alloc(1 + 8)
      buffer.writeUInt8(0xff, 0)
      buffer.writeUInt64LE(BigInt(n), 1)
      this.write(buffer)
    }
  }

  writeVarLengthBuffer(buffer) {
    this.writeVarintNumber(buffer.length)
    this.write(buffer)
  }
}

module.exports = BufferWriter
