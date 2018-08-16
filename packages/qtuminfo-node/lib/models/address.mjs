import mongoose from 'mongoose'

const addressSchema = new mongoose.Schema({
  type: {type: String},
  hex: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex'),
    alias: 'data'
  }
}, {_id: false})

export default addressSchema
