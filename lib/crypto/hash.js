const {createHash} = require('crypto')

function sha256(buffer) {
  return createHash('sha256')
    .update(buffer)
    .digest()
}

function sha256sha256(buffer) {
  return sha256(sha256(buffer))
}

function ripemd160(buffer) {
  return createHash('ripemd160')
    .update(buffer)
    .digest()
}

function sha256ripemd160(buffer) {
  return ripemd160(sha256(buffer))
}

Object.assign(exports, {sha256, sha256sha256, sha256ripemd160})
