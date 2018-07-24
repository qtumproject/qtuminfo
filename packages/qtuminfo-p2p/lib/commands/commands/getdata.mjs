import {BufferReader, BufferWriter} from 'qtuminfo-lib'
import Message from './message'
import {writeInventories, parseInventories} from './utils'

export default class GetDataMessage extends Message {
  constructor({inventories, ...options}) {
    super('getdata', options)
    this.inventories = inventories
  }

  get payload() {
    let writer = new BufferWriter()
    writeInventories(writer, this.inventories)
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.inventories = parseInventories(reader)
    Message.checkFinished(reader)
  }
}
