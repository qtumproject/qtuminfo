import {randomBytes} from 'crypto'

export function getNonce() {
  return randomBytes(8)
}

export function parseIP(reader) {
  let ipv6 = []
  for (let i = 0; i < 8; ++i) {
    let word = reader.read(2)
    ipv6.push(word.toString('hex'))
  }
  return {v6: ipv6.join(':')}
}

export function writeIP(writer, ip) {
  for (let word of ip.v6.split(':')) {
    writer.write(Buffer.from(word, 'hex'))
  }
}

export function parseAddress(reader) {
  let services = reader.readUInt64LE()
  let ip = parseIP(reader)
  let port = reader.readUInt16LE()
  return {services, ip, port}
}

export function writeAddress(writer, address) {
  if (address) {
    writer.writeUInt64LE(address.services)
    writeIP(writer, address.ip)
    writer.writeUInt16LE(address.port)
  } else {
    writer.write(Buffer.alloc(26))
  }
}

export function writeInventories(writer, inventories) {
  writer.writeVarintNumber(inventories.length)
  for (let inventory of inventories) {
    writer.writeUInt32LE(inventory.type)
    writer.write(inventory.data)
  }
}

export function parseInventories(reader) {
  let inventories = []
  let count = reader.readVarintNumber()
  for (let i = 0; i < count; ++i) {
    let type = reader.readUInt32LE()
    let data = reader.read(32)
    inventories.push({type, data})
  }
  return inventories
}
