import {wrapCollectionMethods} from './utils'
import {BigInttoLong, LongtoBigInt} from '../utils'

class Block {
  constructor({hash, height, size, weight, timestamp, transactions, minedBy, coinStakeValue}) {
    this.hash = hash
    this.height = height
    this.size = size
    this.weight = weight
    this.timestamp = timestamp
    this.transactions = transactions
    this.minedBy = minedBy
    this.coinStakeValue = coinStakeValue
  }

  static async init(db, chain) {
    Block.collection = db.collection('blocks')
    Block.chain = chain
    await Block.collection.createIndex({hash: 1}, {unique: true})
    await Block.collection.createIndex({height: 1}, {unique: true})
    await Block.collection.createIndex({timestamp: 1})
    await Block.collection.createIndex({'minedBy.hex': 1, 'minedBy.type': 1})
  }

  static fromRawBlock(block, height) {
    return new Block({
      hash: block.hash,
      height,
      size: block.size,
      weight: block.weight,
      timestamp: block.header.timestamp,
      transactions: block.transactions.map(transaction => transaction.id),
      minedBy: null,
      coinStakeValue: null
    })
  }

  async save() {
    await Block.collection.findOneAndReplace(
      {height: this.height},
      {$set: this.encode()},
      {upsert: true}
    )
  }

  encode() {
    return {
      hash: this.hash.toString('hex'),
      height: this.height,
      size: this.size,
      weight: this.weight,
      timestamp: this.timestamp,
      transactions: this.transactions.map(id => id.toString('hex')),
      transactionCount: this.transactions.length,
      // minedBy: {type: this.minedBy.type, hex: this.minedBy.data.toString('hex')},
      // coinStakeValue: this.coinStakeValue && BigInttoLong(this.coinStakeValue)
    }
  }

  static decode(block) {
    return new Block({
      hash: Buffer.from(block.hash, 'hex'),
      height: block.height,
      size: block.size,
      weight: block.weight,
      timestamp: block.timestamp,
      transactions: block.transactions.map(id => Buffer.from(id, 'hex')),
      // minedBy: {type: this.minedBy.type, data: Buffer.from(this.minedBy.data, 'hex'), chain: block.chain},
      // coinStakeValue: block.coinStakeValue && LongtoBigInt(block.coinStakeValue)
    })
  }
}

export default wrapCollectionMethods(Block)
