import mongoose from 'mongoose'
import {Header as RawHeader} from 'qtuminfo-lib'
import {BigInttoBuffer32, Buffer32toBigInt} from '../utils'

const headerSchema = new mongoose.Schema({
  hash: {
    type: String,
    index: true,
    unique: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  height: {type: Number, index: true, unqiue: true},
  version: Number,
  prevHash: {
    type: String,
    default: '0'.repeat(64),
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  merkleRoot: Buffer,
  timestamp: Number,
  bits: Number,
  nonce: Number,
  hashStateRoot: Buffer,
  hashUTXORoot: Buffer,
  prevOutStakeHash: Buffer,
  prevOutStakeN: Number,
  vchBlockSig: Buffer,
  chainwork: {
    type: Buffer,
    get: Buffer32toBigInt,
    set: BigInttoBuffer32
  }
})

headerSchema.method('isProofOfStake', function() {
  return RawHeader.prototype.isProofOfStake.call(this)
})

headerSchema.virtual('difficulty').get(function() {
  return new RawHeader(this).difficulty
})

export default mongoose.model('Header', headerSchema)
