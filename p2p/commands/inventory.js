const {BufferReader, BufferWriter} = require('../../lib')

const types = {
  ERROR: 0,
  TRANSACTION: 1,
  BLOCK: 2,
  FILTERED_BLOCK: 3,
  CMPCT_BLOCK: 4,
  WITNESS: 0x40000000
}

class Inventory {
  constructor({type, data}) {
    this.type = type
    this.data = data
  }

  static forItem(type, data) {
    return new Inventory({type, data})
  }

  static forTransaction(data) {
    return Inventory.forItem(types.TRANSACTION, data)
  }

  static forBlock(data) {
    return Inventory.forItem(types.BLOCK, data)
  }

  static forFilteredBlock(data) {
    return Inventory.forItem(types.FILTERED_BLOCK, data)
  }

  static fromBuffer(buffer) {
    return Inventory.fromBufferReader(new BufferReader(buffer))
  }

  static fromBufferReader(reader) {
    let type = reader.readUInt32LE()
    let data = reader.read(32)
    return new Inventory({type, data: Buffer.from(data).reverse()})
  }

  toBuffer() {
    let writer = new BufferWriter()
    this.toBufferWriter(writer)
    return writer.toBuffer()
  }

  toBufferWriter(writer) {
    writer.writeUInt32LE(this.type)
    writer.write(Buffer.from(this.data).reverse())
  }
}

exports = module.exports = Inventory
exports.types = types
