const Message = require('./message')

class VerackMessage extends Message {
  constructor(options) {
    super('verack', options)
  }
}

module.exports = VerackMessage
