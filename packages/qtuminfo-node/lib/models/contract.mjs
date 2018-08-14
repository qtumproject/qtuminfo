import mongoose from 'mongoose'
import addressSchema from './address'

const qrc20Schema = new mongoose.Schema({
  name: {type: String, index: true},
  symbol: {type: String, index: true},
  decimals: Number,
  totalSupply: {
    type: String,
    get: s => BigInt(`0x${s}`),
    set: n => n.toString(16).padStart(64, '0')
  },
  version: String
}, {_id: false})

const qrc721Schema = new mongoose.Schema({
  name: {type: String, index: true},
  symbol: {type: String, index: true},
  totalSupply: {
    type: String,
    get: s => BigInt(`0x${s}`),
    set: n => n.toString(16).padStart(64, '0')
  }
}, {_id: false})

const contractSchema = new mongoose.Schema({
  address: {
    type: String,
    index: true,
    unique: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  owner: addressSchema,
  createTransactionId: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  createHeight: {type: Number, index: true},
  type: {type: String, index: true},
  tags: [{type: String, index: true}],
  qrc20: qrc20Schema,
  qrc721: qrc721Schema
})

export default mongoose.model('Contract', contractSchema)
