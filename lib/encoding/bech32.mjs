const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

export class InvalidBech32StringError extends Error {
  constructor(...args) {
    super(...args)
    Error.captureStackTrace(this, this.constructor)
  }

  get name() {
    return this.constructor.name
  }
}

function polymod(values) {
  let mod = 1
  for (let x of values) {
    let top = mod >>> 25
    mod = (mod & 0x1ffffff) << 5 | x
    for (let i = 0; i < 5; ++i) {
      if (top >>> i & 1) {
        mod ^= GENERATOR[i]
      }
    }
  }
  return mod
}

function hrpExpand(hrp) {
  let result = []
  for (let p = 0; p < hrp.length; ++p) {
    result.push(hrp.charCodeAt(p) >>> 5)
  }
  result.push(0)
  for (let p = 0; p < hrp.length; ++p) {
    result.push(hrp.charCodeAt(p) & 31)
  }
  return result
}

function verifyChecksum(hrp, data) {
  return polymod(hrpExpand(hrp).concat(data)) === 1
}

function createChecksum(hrp, data) {
  let values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]
  let mod = polymod(values) ^ 1
  let result = []
  for (let p = 0; p < 6; ++p) {
    result.push(mod >>> 5 * (5 - p) & 31)
  }
  return result
}

export function encode(hrp, data) {
  let combined = data.concat(createChecksum(hrp, data))
  return `${hrp}1${combined.map(s => CHARSET[s]).join('')}`
}

export function decode(bechString) {
  let hasLower = false
  let hasUpper = false
  for (let p = 0; p < bechString.length; ++p) {
    let code = bechString.charCodeAt(p)
    if (code < 33 || code > 126) {
      throw new InvalidBech32StringError(bechString)
    }
    if (code >= 97 && code <= 122) {
      hasLower = true
    }
    if (code >= 65 && code <= 90) {
      hasUpper = true
    }
  }
  if (hasLower && hasUpper) {
    throw new InvalidBech32StringError(bechString)
  }
  bechString = bechString.toLowerCase()
  let position = bechString.lastIndexOf('1')
  if (position < 1 || position + 7 > bechString.length || bechString.length > 90) {
    throw new InvalidBech32StringError(bechString)
  }
  let hrp = bechString.slice(0, position)
  let data = []
  for (let s of bechString.slice(position + 1)) {
    let d = CHARSET.indexOf(s)
    if (d === -1) {
      throw new InvalidBech32StringError(bechString)
    }
    data.push(d)
  }
  if (!verifyChecksum(hrp, data)) {
    throw new InvalidBech32StringError(bechString)
  }
  return {hrp, data: data.slice(0, data.length - 6)}
}
