const Message = require('./message')

class SendHeadersMessage extends Message {
  constructor(options) {
    super('sendheaders', options)
  }
}

module.exports = SendHeadersMessage
