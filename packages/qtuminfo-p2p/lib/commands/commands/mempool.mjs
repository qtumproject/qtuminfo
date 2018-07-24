import Message from './message'

export default class MempoolMessage extends Message {
  constructor(options) {
    super('mempool', options)
  }
}
