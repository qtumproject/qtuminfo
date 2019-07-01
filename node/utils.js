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

function transformSQLArg(arg) {
  if (typeof arg === 'string') {
    return `'${arg}'`
  } else if (['number', 'bigint'].includes(typeof arg)) {
    return arg.toString()
  } else if (Buffer.isBuffer(arg)) {
    return `X'${arg.toString('hex')}'`
  } else if (Array.isArray(arg)) {
    return arg.length === 0 ? '(NULL)' : `(${arg.map(transformSQLArg).join(', ')})`
  } else if (arg && 'raw' in arg) {
    return arg.raw
  }
  return arg.toString()
}

function sql(strings, ...args) {
  let buffer = []
  for (let i = 0; i < args.length; ++i) {
    buffer.push(strings[i].replace(/\s+/g, ' '), transformSQLArg(args[i]))
  }
  buffer.push(strings[args.length].replace(/\s+/g, ' '))
  return buffer.join('')
}


Object.assign(exports, {
  AsyncQueue,
  sql
})
