const Message = require('./message')

class GetAddrMessage extends Message {
  constructor(options) {
    super('getaddr', options)
  }
}

module.exports = GetAddrMessage
