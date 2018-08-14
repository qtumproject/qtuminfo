import mongoose from 'mongoose'
import {Address} from 'qtuminfo-lib'

const addressSchema = new mongoose.Schema({
  type: {type: String},
  hex: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex'),
    alias: 'data'
  }
}, {_id: false})

addressSchema.method('getRawAddress', function() {
  return new Address({type: this.type, data: this.hex, chain: mongoose.chain})
})

export default addressSchema
