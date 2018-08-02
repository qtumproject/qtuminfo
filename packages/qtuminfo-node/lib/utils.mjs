import mongodb from 'mongodb'

const {Long} = mongodb

export class AsyncQueue {
  constructor(fn) {
    this.fn = fn
    this.waiting = []
    this.running = false
  }

  get length() {
    return this.waiting.length
  }

  push(data, callback) {
    this.waiting.push({data, callback})
    if (!this.running) {
      this.process()
    }
  }

  process() {
    this.running = true
    let {data, callback} = this.waiting.pop()
    this.fn(data).then(
      data => {
        callback(null, data)
        if (this.waiting.length) {
          this.process()
        } else {
          this.running = false
        }
      },
      callback
    )
  }
}

export function BigInttoBuffer32(n) {
  let result = []
  for (let i = 0; i < 32; ++i) {
    result.push(Number(n & 0xffn))
    n >>= 8n
  }
  return Buffer.from(result)
}

export function Buffer32toBigInt(buffer) {
  let result = 0n
  for (let i = 0; i < 32; ++i) {
    result |= BigInt(buffer[i]) << BigInt(i)
  }
  return result
}

export function BigInttoLong(n) {
  let result = new Long(Number(n & 0xffffffffn), Number(n >> 32n & 0xffffffffn))
  return n < 0n ? result.negate() : result
}

export function LongtoBigInt(n) {
  let high = BigInt(n.getHighBits()) << 32n
  let low = n.getLowBits()
  low = BigInt(low < 0 ? 0xffffffff - low : low)
  return high | low
}
