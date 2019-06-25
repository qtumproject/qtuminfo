const util = require('util')
const BufferReader = require('../encoding/buffer-reader')
const BufferWriter = require('../encoding/buffer-writer')
const Transaction = require('../transaction')
const Header = require('./header')

class Block {
  constructor({header, transactions}) {
    this.header = header
    this.transactions = transactions
  }

  get id() {
    return this.header.id
  }

  get hash() {
    return this.header.hash
  }

  get size() {
    return this.toBuffer().length
  }

  get weight() {
    return this.toBuffer().length + this.toHashBuffer().length * 3
  }

  static fromBuffer(buffer) {
    return Block.fromBufferReader(new BufferReader(buffer))
  }

  static fromBufferReader(reader) {
    let header = Header.fromBufferReader(reader)
    let transactionCount = reader.readVarintNumber()
    let transactions = []
    for (let i = 0; i < transactionCount; ++i) {
      transactions.push(Transaction.fromBufferReader(reader))
    }
    return new Block({header, transactions})
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toHashBuffer() {
    let writer = new BufferWriter()
    this.toHashBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    this.header.toBufferWriter(writer)
    writer.writeVarintNumber(this.transactions.length)
    for (let transaction of this.transactions) {
      transaction.toBufferWriter(writer)
    }
  }

  toHashBufferWriter(writer) {
    this.header.toBufferWriter(writer)
    writer.writeVarintNumber(this.transactions.length)
    for (let transaction of this.transactions) {
      transaction.toHashBufferWriter(writer)
    }
  }

  [util.inspect.custom]() {
    return `<Block ${this.id.toString('hex')}>`
  }
}

module.exports = Block
