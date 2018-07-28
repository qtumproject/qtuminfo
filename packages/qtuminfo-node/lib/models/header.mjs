import {Header as RawHeader} from 'qtuminfo-lib'
import {wrapCollectionMethods} from './utils'
import {BigInttoBuffer32, Buffer32toBigInt} from '../utils'

class Header extends RawHeader {
  constructor({
    hash, height,
    version, prevHash, merkleRoot, timestamp, bits, nonce,
    hashStateRoot, hashUTXORoot, prevOutStakeHash, prevOutStakeN, vchBlockSig,
    chainwork
  }) {
    super({
      version, prevHash, merkleRoot, timestamp, bits, nonce,
      hashStateRoot, hashUTXORoot, prevOutStakeHash, prevOutStakeN, vchBlockSig
    })
    this._hash = hash
    this.height = height
    this.chainwork = chainwork
  }

  static async init(db) {
    Header.collection = db.collection('headers')
    await Header.collection.createIndex({hash: 1}, {unique: true})
    await Header.collection.createIndex({height: 1}, {unique: true})
  }

  static fromRawHeader(header, height, chainwork) {
    return new Header({
      hash: header.hash,
      height,
      ...header,
      chainwork
    })
  }

  async save() {
    await Header.collection.findOneAndReplace(
      {height: this.height},
      {$set: this.encode()},
      {upsert: true}
    )
  }

  encode() {
    return {
      hash: this.hash.toString('hex'),
      height: this.height,
      version: this.version,
      prevHash: this.prevHash.toString('hex'),
      merkleRoot: this.merkleRoot,
      timestamp: this.timestamp,
      bits: this.bits,
      nonce: this.nonce,
      hashStateRoot: this.hashStateRoot,
      hashUTXORoot: this.hashUTXORoot,
      prevOutStakeHash: this.prevOutStakeHash,
      prevOutStakeN: this.prevOutStakeN,
      vchBlockSig: this.vchBlockSig,
      chainwork: BigInttoBuffer32(this.chainwork)
    }
  }

  static decode(header) {
    return new Header({
      hash: Buffer.from(header.hash, 'hex'),
      height: header.height,
      version: header.version,
      prevHash: Buffer.from(header.prevHash, 'hex'),
      merkleRoot: header.merkleRoot.buffer,
      timestamp: header.timestamp,
      bits: header.bits,
      nonce: header.nonce,
      hashStateRoot: header.hashStateRoot.buffer,
      hashUTXORoot: header.hashUTXORoot.buffer,
      prevOutStakeHash: header.prevOutStakeHash.buffer,
      prevOutStakeN: header.prevOutStakeN,
      vchBlockSig: header.vchBlockSig.buffer,
      chainwork: Buffer32toBigInt(header.chainwork.buffer)
    })
  }

  static async findOne(...args) {
    let header = await Header.collection.findOne(...args)
    return header && Header.decode(header)
  }
}

export default wrapCollectionMethods(Header)
