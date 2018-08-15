import mongoose from 'mongoose'
import mongooseLong from 'mongoose-long'
import addressSchema from './address'
import {BigInttoLong, LongtoBigInt} from '../utils'

mongooseLong(mongoose)

const addressInfoSchema = new mongoose.Schema({
  address: {type: addressSchema, index: true},
  string: {type: String, index: true},
  createHeight: {type: Number, index: true},
  balance: {
    type: mongoose.Schema.Types.Long,
    index: true,
    get: LongtoBigInt,
    set: BigInttoLong
  }
})

export default mongoose.model('AddressInfo', addressInfoSchema)
