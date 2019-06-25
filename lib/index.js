const Hash = require('./crypto/hash')
const BufferReader = require('./encoding/buffer-reader')
const BufferWriter = require('./encoding/buffer-writer')
const {Base58, Base58Check, InvalidBase58Error, InvalidBase58ChecksumError} = require('./encoding/base58')
const SegwitAddress = require('./encoding/segwit-address')
const {InvalidSegwitAddressError} = SegwitAddress
const Chain = require('./chain')
const Address = require('./address')
const Block = require('./block/block')
const Header = require('./block/header')
const Script = require('./script')
const {InvalidScriptError} = Script
const Opcode = require('./script/opcode')
const InputScript = require('./script/input')
const {
  CoinbaseScript,
  PublicKeyInputScript,
  PublicKeyHashInputScript,
  ScriptHashInputScript,
  MultisigInputScript,
  WitnessV0KeyHashInputScript,
  WitnessV0ScriptHashInputScript,
  ContractSpendScript
} = InputScript
const OutputScript = require('./script/output')
const {
  PublicKeyOutputScript,
  PublicKeyHashOutputScript,
  ScriptHashOutputScript,
  MultisigOutputScript,
  DataOutputScript,
  WitnessV0KeyHashOutputScript,
  WitnessV0ScriptHashOut,
  EVMContractCreateScript,
  EVMContractCreateBySenderScript,
  EVMContractCallScript,
  EVMContractCallBySenderScript,
  ContractOutputScript
} = OutputScript
const Transaction = require('./transaction')
const Input = require('./transaction/input')
const Output = require('./transaction/output')
const Solidity = require('./solidity/abi')

Object.assign(exports, {
  Hash,
  BufferReader,
  BufferWriter,
  Base58,
  Base58Check,
  InvalidBase58Error,
  InvalidBase58ChecksumError,
  SegwitAddress,
  InvalidSegwitAddressError,
  Chain,
  Address,
  Block,
  Header,
  Script,
  InvalidScriptError,
  Opcode,
  InputScript,
  CoinbaseScript,
  PublicKeyInputScript,
  PublicKeyHashInputScript,
  ScriptHashInputScript,
  MultisigInputScript,
  WitnessV0KeyHashInputScript,
  WitnessV0ScriptHashInputScript,
  ContractSpendScript,
  OutputScript,
  PublicKeyOutputScript,
  PublicKeyHashOutputScript,
  ScriptHashOutputScript,
  MultisigOutputScript,
  DataOutputScript,
  WitnessV0KeyHashOutputScript,
  WitnessV0ScriptHashOut,
  EVMContractCreateScript,
  EVMContractCreateBySenderScript,
  EVMContractCallScript,
  EVMContractCallBySenderScript,
  ContractOutputScript,
  Transaction,
  Input,
  Output,
  Solidity
})
