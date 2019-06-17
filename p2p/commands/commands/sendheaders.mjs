import Message from './message'

export default class SendHeadersMessage extends Message {
  constructor(options) {
    super('sendheaders', options)
  }
}
