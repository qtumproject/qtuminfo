import util from 'util'
import {BufferReader, BufferWriter, Hash} from '..'

const GENESIS_BITS = 0x1d00ffff

export default class Header {
  constructor({
    version, prevHash, merkleRoot, timestamp, bits, nonce,
    hashStateRoot, hashUTXORoot, prevOutStakeHash, prevOutStakeN, signature
  }) {
    this.version = version
    this.prevHash = prevHash || Buffer.alloc(32)
    this.merkleRoot = merkleRoot
    this.timestamp = timestamp
    this.bits = bits
    this.nonce = nonce
    this.hashStateRoot = hashStateRoot
    this.hashUTXORoot = hashUTXORoot
    this.prevOutStakeHash = prevOutStakeHash
    this.prevOutStakeN = prevOutStakeN
    this.signature = signature
  }

  static fromBuffer(buffer) {
    return Header.fromBufferReader(new BufferReader(buffer))
  }

  static fromBufferReader(reader) {
    let version = reader.readInt32LE()
    let prevHash = Buffer.from(reader.read(32)).reverse()
    let merkleRoot = Buffer.from(reader.read(32)).reverse()
    let timestamp = reader.readUInt32LE()
    let bits = reader.readUInt32LE()
    let nonce = reader.readUInt32LE()
    let hashStateRoot = Buffer.from(reader.read(32)).reverse()
    let hashUTXORoot = Buffer.from(reader.read(32)).reverse()
    let prevOutStakeHash = Buffer.from(reader.read(32)).reverse()
    let prevOutStakeN = reader.readUInt32LE()
    let signature = reader.readVarLengthBuffer()
    return new Header({
      version, prevHash, merkleRoot, timestamp, bits, nonce,
      hashStateRoot, hashUTXORoot, prevOutStakeHash, prevOutStakeN, signature
    })
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    writer.writeInt32LE(this.version)
    writer.write(Buffer.from(this.prevHash).reverse())
    writer.write(Buffer.from(this.merkleRoot).reverse())
    writer.writeUInt32LE(this.timestamp)
    writer.writeUInt32LE(this.bits)
    writer.writeUInt32LE(this.nonce)
    writer.write(Buffer.from(this.hashStateRoot).reverse())
    writer.write(Buffer.from(this.hashUTXORoot).reverse())
    writer.write(Buffer.from(this.prevOutStakeHash).reverse())
    writer.writeUInt32LE(this.prevOutStakeN)
    writer.writeVarLengthBuffer(this.signature)
  }

  get id() {
    return this.hash
  }

  get hash() {
    this._hash = this._hash || Hash.sha256sha256(this.toBuffer()).reverse()
    return this._hash
  }

  [util.inspect.custom](depth = 0) {
    if (depth === 0) {
      return `<Header ${this.hash.toString('hex')}>`
    } else {
      return `Header ${JSON.stringify({
        hash: this.hash.toString('hex'),
        version: this.version,
        prevHash: this.prevHash.toString('hex'),
        timestamp: this.timestamp,
        bits: this.bits,
        nonce: this.nonce,
        hashStateRoot: this.hashStateRoot.toString('hex'),
        hashUTXORoot: this.hashUTXORoot.toString('hex'),
        prevOutStakeHash: this.prevOutStakeHash.toString('hex'),
        prevOutStakeN: this.prevOutStakeN,
        signature: this.signature.toString('hex')
      }, null, 2)}`
    }
  }

  isProofOfStake() {
    return Buffer.compare(this.prevOutStakeHash, Buffer.alloc(32)) !== 0 && this.prevOutStakeN !== 0xffffffff
  }

  get difficulty() {
    function getTargetDifficulty(bits) {
      return (bits & 0xffffff) * 2 ** ((bits >>> 24) - 3 << 3)
    }
    return getTargetDifficulty(GENESIS_BITS) / getTargetDifficulty(this.bits)
  }
}
