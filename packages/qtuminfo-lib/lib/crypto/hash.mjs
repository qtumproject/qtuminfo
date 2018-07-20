import {createHash} from 'crypto'

export function sha256(buffer) {
  return createHash('sha256')
    .update(buffer)
    .digest()
}

export function sha256sha256(buffer) {
  return sha256(sha256(buffer))
}

export function ripemd160(buffer) {
  return createHash('ripemd160')
    .update(buffer)
    .digest()
}

export function sha256ripemd160(buffer) {
  return ripemd160(sha256(buffer))
}
