import mongoose from 'mongoose'

const tipSchema = new mongoose.Schema({
  service: {type: String, index: true, unique: true},
  height: Number,
  hash: Buffer
})

export default mongoose.model('Tip', tipSchema)
