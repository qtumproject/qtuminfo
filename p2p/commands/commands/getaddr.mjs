import Message from './message'

export default class GetAddrMessage extends Message {
  constructor(options) {
    super('getaddr', options)
  }
}
