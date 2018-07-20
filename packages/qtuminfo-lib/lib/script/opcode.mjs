import util from 'util'
import opcodes from 'qtum-opcodes'

let map = opcodes
let reverseMap = []
for (let [key, value] of Object.entries(opcodes)) {
  reverseMap[value] = key
}

export default class Opcode {
  constructor(arg) {
    if (typeof arg === 'number') {
      this.code = arg
    } else if (typeof arg === 'string') {
      this.code = map[arg]
    }
  }

  toBuffer() {
    return Buffer.from([this.code])
  }

  toString() {
    return reverseMap[this.code]
  }

  isSmallInt() {
    return this.code === opcodes.OP_0 || this.code >= opcodes.OP_1 && this.code <= opcodes.OP_16
  }

  [util.inspect.custom]() {
    return `<Opcode ${this.toString()}>`
  }
}

Object.assign(Opcode, {...map, reverseMap})
