import mongoose from 'mongoose'
import addressSchema from './address'
import {LongtoBigInt, BigInttoLong} from '../utils'

const blockSchema = new mongoose.Schema({
  hash: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  height: Number,
  timestamp: Number
}, {_id: false})

const qtumBalanceChangesSchema = new mongoose.Schema({
  id: {
    type: String,
    index: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  block: {
    type: blockSchema,
    default: {height: 0xffffffff},
    timestamp: Number
  },
  index: Number,
  address: addressSchema,
  value: {
    type: mongoose.Schema.Types.Long,
    get: LongtoBigInt,
    set: BigInttoLong
  }
})

qtumBalanceChangesSchema.index({'block.height': 1, index: 1})
qtumBalanceChangesSchema.index({address: 1, 'block.height': 1, index: 1})
qtumBalanceChangesSchema.index({address: 1, 'block.timestamp': 1})

export default mongoose.model('QtumBalanceChanges', qtumBalanceChangesSchema)
