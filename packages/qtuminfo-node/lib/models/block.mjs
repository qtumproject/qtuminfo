import mongoose from 'mongoose'
import mongooseLong from 'mongoose-long'
import addressSchema from './address'
import {BigInttoLong, LongtoBigInt} from '../utils'

mongooseLong(mongoose)

const blockSchema = new mongoose.Schema({
  hash: {
    type: String,
    index: true,
    unique: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  height: {type: Number, index: true, unique: true},
  prevHash: {
    type: String,
    default: '0'.repeat(64),
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  timestamp: Number,
  size: Number,
  weight: Number,
  transactions: [{
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  }],
  transactionCount: Number,
  miner: {type: addressSchema, index: true},
  coinstakeValue: {
    type: mongoose.Schema.Types.Long,
    get: LongtoBigInt,
    set: BigInttoLong
  }
})

export default mongoose.model('Block', blockSchema)
