import mongoose from 'mongoose'
import mongooseLong from 'mongoose-long'
import {Address} from 'qtuminfo-lib'
import addressSchema from './address'
import {Buffer32toBigInt, BigInttoLong, LongtoBigInt} from '../utils'

mongooseLong(mongoose)

const blockSchema = new mongoose.Schema({
  hash: {
    type: String,
    index: true,
    unique: true,
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  height: {type: Number, index: true, unique: true},
  prevHash: {
    type: String,
    default: '0'.repeat(64),
    get: s => Buffer.from(s, 'hex'),
    set: x => x.toString('hex')
  },
  timestamp: Number,
  size: Number,
  weight: Number,
  transactions: [String],
  transactionCount: Number,
  miner: addressSchema,
  coinStakeValue: {
    type: mongoose.Schema.Types.Long,
    get: LongtoBigInt,
    set: BigInttoLong
  }
})

blockSchema.static('getBlock', async function(filter) {
  let [block] = await this.aggregate([
    {$match: filter},
    {
      $lookup: {
        from: 'headers',
        localField: 'hash',
        foreignField: 'hash',
        as: 'header'
      }
    },
    {$addFields: {header: {$arrayElemAt: ['$header', 0]}}}
  ])
  if (!block) {
    return null
  }
  let result = {
    hash: Buffer.from(block.hash, 'hex'),
    height: block.height,
    version: block.header.version,
    prevHash: Buffer.from(block.prevHash, 'hex'),
    merkleRoot: block.header.merkleRoot.buffer,
    bits: block.header.bits,
    nonce: block.header.nonce,
    hashStateRoot: block.header.hashStateRoot.buffer,
    hashUTXORoot: block.header.hashUTXORoot.buffer,
    prevOutStakeHash: block.header.prevOutStakeHash.buffer,
    prevOutStakeN: block.header.prevOutStakeN,
    vchBlockSig: block.header.vchBlockSig.buffer,
    chainwork: Buffer32toBigInt(block.header.chainwork.buffer),
    size: block.size,
    weight: block.weight,
    transactions: block.transactions.map(id => Buffer.from(id, 'hex')),
    miner: block.miner && new Address({
      type: block.miner.type,
      data: Buffer.from(block.miner.hex, 'hex')
    }),
    coinStakeValue: block.coinStakeValue && LongtoBigInt(block.coinStakeValue)
  }
  let nextBlock = await this.model('Header').findOne({height: block.height + 1}, 'hash', {lean: true})
  result.nextHash = nextBlock && Buffer.from(nextBlock.hash, 'hex')
  return result
})

export default mongoose.model('Block', blockSchema)
