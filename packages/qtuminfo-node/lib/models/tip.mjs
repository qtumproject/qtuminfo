import mongoose from 'mongoose'

const tipSchema = new mongoose.Schema({
  service: {type: String, index: true, unique: true},
  tip: new mongoose.Schema({height: Number, hash: Buffer}, {_id: false})
})

export default mongoose.model('Tip', tipSchema)
