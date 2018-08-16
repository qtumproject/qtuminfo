import mongoose from 'mongoose'
import addressSchema from './address'

const blockSchema = new mongoose.Schema({
  hash: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  height: Number,
  timestamp: {type: Number, index: true}
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
  block: {
    type: blockSchema,
    default: {height: 0xffffffff}
  },
  index: Number,
  size: Number,
  relatedAddresses: [addressSchema],
  receipts: [receiptSchema]
})

transactionSchema.index({'block.height': 1, index: 1})
transactionSchema.index({relatedAddresses: 1})

export default mongoose.model('Transaction', transactionSchema)
