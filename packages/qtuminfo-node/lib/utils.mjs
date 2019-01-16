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
