import {BufferReader, BufferWriter} from '../../../lib'
import Message from './message'
import {getNonce, parseAddress, writeAddress} from './utils'
import packageInfo from '../../../package.json'

export default class VersionMessage extends Message {
  constructor({
    services = 13n,
    nonce = getNonce(),
    timestamp = Math.floor(Date.now() / 1000),
    subversion = `/qtuminfo:${packageInfo.version}/`,
    startHeight = 0,
    relay = true,
    ...options
  }) {
    super('version', options)
    this.version = options.protocolVersion || 70016
    this.nonce = nonce
    this.services = services
    this.timestamp = timestamp
    this.subversion = subversion
    this.startHeight = startHeight
    this.relay = relay
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeUInt32LE(this.version)
    writer.writeUInt64LE(this.services)
    writer.writeUInt32LE(this.timestamp)
    writer.write(Buffer.alloc(4))
    writeAddress(writer, this.myAddress)
    writeAddress(writer, this.yourAddress)
    writer.write(this.nonce)
    writer.writeVarLengthBuffer(Buffer.from(this.subversion, 'ascii'))
    writer.writeUInt32LE(this.startHeight)
    writer.writeUInt8(this.relay)
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.version = reader.readUInt32LE()
    this.services = reader.readUInt64LE()
    this.timestamp = reader.readUInt32LE()
    reader.read(4)
    this.myAddress = parseAddress(reader)
    this.yourAddress = parseAddress(reader)
    this.nonce = reader.read(8)
    this.subversion = reader.readVarLengthBuffer().toString()
    this.startHeight = reader.readUInt32LE()
    this.relay = reader.finished ? true : Boolean(reader.readUInt8())
    Message.checkFinished(reader)
  }
}
