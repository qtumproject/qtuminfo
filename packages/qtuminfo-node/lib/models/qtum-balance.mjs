import mongoose from 'mongoose'
import mongooseLong from 'mongoose-long'
import addressSchema from './address'
import {BigInttoLong, LongtoBigInt} from '../utils'

mongooseLong(mongoose)

const qtumBalanceSchema = new mongoose.Schema({
  height: Number,
  address: addressSchema,
  balance: {
    type: mongoose.Schema.Types.Long,
    get: LongtoBigInt,
    set: BigInttoLong
  }
})

qtumBalanceSchema.index({height: 1, balance: 1})

export default mongoose.model('QtumBalance', qtumBalanceSchema)
