import {BufferReader} from 'qtuminfo-lib'
import Message from './message'
import {getNonce} from './utils'

export default class PongMessage extends Message {
  constructor({nonce = getNonce(), ...options}) {
    super('pong', options)
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
