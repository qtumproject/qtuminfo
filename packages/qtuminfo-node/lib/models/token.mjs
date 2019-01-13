import mongoose from 'mongoose'

const qrc20TokenBalanceSchema = new mongoose.Schema({
  contract: {
    type: String,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  address: {
    type: String,
    index: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  balance: {
    type: String,
    get: s => BigInt(`0x${s}`),
    set: n => n.toString(16).padStart(64, '0')
  }
})

qrc20TokenBalanceSchema.index({contract: 1, balance: -1})

export default mongoose.model('QRC20TokenBalance', qrc20TokenBalanceSchema)
