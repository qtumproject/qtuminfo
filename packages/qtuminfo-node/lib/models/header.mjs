import mongoose from 'mongoose'
import {Header as RawHeader} from 'qtuminfo-lib'

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
  signature: Buffer,
  chainwork: {
    type: Buffer,
    get: x => BigInt(`0x${x.toString('hex')}`),
    set: n => Buffer.from(n.toString(16).padStart(64, '0'), 'hex')
  },
  interval: Number
})

headerSchema.method('isProofOfStake', function() {
  return RawHeader.prototype.isProofOfStake.call(this)
})

headerSchema.virtual('difficulty').get(function() {
  return new RawHeader(this).difficulty
})

export default mongoose.model('Header', headerSchema)
