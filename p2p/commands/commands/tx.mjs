import {Transaction} from '../../../lib'
import Message from './message'

export default class TxMessage extends Message {
  constructor({transaction, ...options}) {
    super('tx', options)
    this.transaction = transaction
  }

  get payload() {
    return this.block.toBuffer()
  }

  set payload(payload) {
    this.transaction = Transaction.fromBuffer(payload)
  }
}
