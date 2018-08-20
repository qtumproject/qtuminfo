import mongoose from 'mongoose'
import mongooseLong from 'mongoose-long'
mongooseLong(mongoose)

const {Long} = mongoose.Types

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

export function BigInttoLong(n) {
  let m = n < 0n ? -n : n
  let result = new Long(Number(m & 0xffffffffn), Number(m >> 32n & 0xffffffffn))
  return n < 0n ? result.negate() : result
}

export function LongtoBigInt(n) {
  let high = BigInt(n.getHighBits()) << 32n
  let low = n.getLowBits()
  low = BigInt(low < 0 ? 0x100000000 + low : low)
  return high | low
}

export function toBigInt(n) {
  if (n == null) {
    return n
  } else if (n instanceof Long) {
    return LongtoBigInt(n)
  } else if (typeof n === 'number') {
    return BigInt(n)
  } else {
    return n
  }
}
