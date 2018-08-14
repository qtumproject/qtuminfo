import mongoose from 'mongoose'
import addressSchema from './address'
import {BigInttoLong, LongtoBigInt} from '../utils'

const blockSchema = new mongoose.Schema({
  hash: {
    type: String,
    default: '0'.repeat(64),
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  height: {type: Number, default: 0xffffffff},
  timestamp: {type: Number, index: true}
}, {_id: false})

const balanceChangesSchema = new mongoose.Schema({
  address: addressSchema,
  value: {
    type: mongoose.Schema.Types.Long,
    get: LongtoBigInt,
    set: BigInttoLong
  }
}, {_id: false})

const receiptLogSchema = new mongoose.Schema({
  address: {
    type: String,
    index: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  topics: [{
    type: String,
    index: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  }],
  data: Buffer
}, {_id: false})

const receiptSchema = new mongoose.Schema({
  gasUsed: Number,
  contractAddress: {
    type: String,
    index: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  excepted: String,
  logs: [receiptLogSchema]
}, {_id: false})

const transactionSchema = new mongoose.Schema({
  id: {
    type: String,
    index: true,
    unique: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  hash: {
    type: String,
    index: true,
    unique: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  version: Number,
  marker: Number,
  flag: Number,
  witnesses: [[Buffer]],
  lockTime: Number,
  block: blockSchema,
  index: Number,
  size: Number,
  balanceChanges: [balanceChangesSchema],
  receipts: [receiptSchema],
  createIndex: {type: Number, index: true}
})

transactionSchema.index({'balanceChanges.address': 1})
transactionSchema.index({'block.height': 1, index: 1})

export default mongoose.model('Transaction', transactionSchema)
