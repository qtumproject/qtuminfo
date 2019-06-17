import {BufferReader} from '../../../lib'
import Message from './message'
import {getNonce} from './utils'

export default class PingMessage extends Message {
  constructor({nonce = getNonce(), ...options}) {
    super('ping', options)
    this.nonce = nonce
  }

  get payload() {
    return this.nonce
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.nonce = reader.read(8)
    Message.checkFinished(reader)
  }
}
