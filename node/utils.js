class AsyncQueue {
  #fn = null
  #waiting = []
  #running = false

  constructor(fn) {
    this.#fn = fn
  }

  get length() {
    return this.#waiting.length
  }

  push(data, callback) {
    this.#waiting.push({data, callback})
    if (!this.#running) {
      this.process()
    }
  }

  process() {
    this.#running = true
    let {data, callback} = this.#waiting.pop()
    this.#fn(data).then(
      data => {
        callback(null, data)
        if (this.#waiting.length) {
          this.process()
        } else {
          this.#running = false
        }
      },
      callback
    )
  }
}

exports.AsyncQueue = AsyncQueue
