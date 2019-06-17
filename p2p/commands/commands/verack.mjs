import Message from './message'

export default class VerackMessage extends Message {
  constructor(options) {
    super('verack', options)
  }
}
