const {randomBytes} = require('crypto')

function getNonce() {
  return randomBytes(8)
}

function parseIP(reader) {
  let ipv6 = []
  for (let i = 0; i < 8; ++i) {
    let word = reader.read(2)
    ipv6.push(word.toString('hex'))
  }
  return {v6: ipv6.join(':')}
}

function writeIP(writer, ip) {
  for (let word of ip.v6.split(':')) {
    writer.write(Buffer.from(word, 'hex'))
  }
}

function parseAddress(reader) {
  let services = reader.readUInt64LE()
  let ip = parseIP(reader)
  let port = reader.readUInt16BE()
  return {services, ip, port}
}

function writeAddress(writer, address) {
  if (address) {
    writer.writeUInt64LE(address.services)
    writeIP(writer, address.ip)
    writer.writeUInt16BE(address.port)
  } else {
    writer.write(Buffer.alloc(26))
  }
}

function writeInventories(writer, inventories) {
  writer.writeVarintNumber(inventories.length)
  for (let inventory of inventories) {
    writer.writeUInt32LE(inventory.type)
    writer.write(inventory.data)
  }
}

function parseInventories(reader) {
  let inventories = []
  let count = reader.readVarintNumber()
  for (let i = 0; i < count; ++i) {
    let type = reader.readUInt32LE()
    let data = reader.read(32)
    inventories.push({type, data})
  }
  return inventories
}

Object.assign(exports, {
  getNonce,
  parseIP,
  writeIP,
  parseAddress,
  writeAddress,
  writeInventories,
  parseInventories
})
