import mongoose from 'mongoose'
import mongooseLong from 'mongoose-long'
import addressSchema from './address'
import {BigInttoLong, LongtoBigInt} from '../utils'

mongooseLong(mongoose)

const outputSchema = new mongoose.Schema({
  height: {type: Number, default: 0xffffffff, index: true},
  transactionId: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  index: {type: Number, default: 0xffffffff},
  scriptPubKey: Buffer
}, {_id: false})
outputSchema.index({transactionId: 1, index: 1})

const inputSchema = new mongoose.Schema({
  height: {type: Number, index: true},
  transactionId: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  index: Number,
  scriptSig: Buffer,
  sequence: Number
}, {_id: false})
inputSchema.index({transactionId: 1, index: 1})

const transactionOutputSchema = new mongoose.Schema({
  output: outputSchema,
  input: inputSchema,
  address: {type: addressSchema, index: true},
  value: {
    type: mongoose.Schema.Types.Long,
    default: mongoose.Types.Long(0),
    get: LongtoBigInt,
    set: BigInttoLong
  },
  isStake: {type: Boolean, default: false, index: true}
})


export default mongoose.model('TransactionOutput', transactionOutputSchema)
