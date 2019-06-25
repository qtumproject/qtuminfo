const Message = require('./message')

class MempoolMessage extends Message {
  constructor(options) {
    super('mempool', options)
  }
}

module.exports = MempoolMessage
