import {Block} from '../../../lib'
import Message from './message'

export default class BlockMessage extends Message {
  constructor({block, ...options}) {
    super('block', options)
    this.block = block
  }

  get payload() {
    return this.block.toBuffer()
  }

  set payload(payload) {
    this.block = Block.fromBuffer(payload)
  }
}
