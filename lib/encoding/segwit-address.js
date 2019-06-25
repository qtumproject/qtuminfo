const Bech32 = require('./bech32')

class InvalidSegwitAddressError extends Error {
  constructor(...args) {
    super(...args)
    Error.captureStackTrace(this, this.constructor)
  }

  get name() {
    return this.constructor.name
  }
}

function convertBits(data, fromBits, toBits, padding) {
  let acc = 0
  let bits = 0
  let result = []
  let maxV = (1 << toBits) - 1
  for (let p = 0; p < data.length; ++p) {
    let value = data[p]
    if (value < 0 || value >>> fromBits !== 0) {
      return null
    }
    acc = acc << fromBits | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push(acc >>> bits & maxV)
    }
  }
  if (padding) {
    if (bits > 0) {
      result.push(acc << toBits - bits & maxV)
    }
  } else if (bits >= fromBits || acc << toBits - bits & maxV) {
    return null
  }
  return Buffer.from(result)
}

class SegwitAddress {
  static encode(hrp, version, program) {
    return Bech32.encode(hrp, [version, ...convertBits(program, 8, 5, true)])
  }

  static decode(address) {
    try {
      let {hrp, data} = Bech32.decode(address)
      let [version, ...programBits] = data
      if (data.length < 1 || data[0] > 16) {
        throw new InvalidSegwitAddressError(address)
      }
      let program = convertBits(programBits, 5, 8, false)
      if (program === null || program.length < 2 || program.length > 40) {
        return null
      }
      if (version === 0 && program.length !== 20 && program.length !== 32) {
        return null
      }
      return {hrp, version, program}
    } catch (err) {
      if (err instanceof Bech32.InvalidBech32StringError) {
        throw new InvalidSegwitAddressError(address)
      }
    }
  }
}

exports = module.exports = SegwitAddress
exports.InvalidSegwitAddressError = InvalidSegwitAddressError
