const AddrMessage = require('./addr')
const BlockMessage = require('./block')
const FeeFilterMessage = require('./feefilter')
const GetAddrMessage = require('./getaddr')
const GetBlocksMessage = require('./getblocks')
const GetDataMessage = require('./getdata')
const GetHeadersMessage = require('./getheaders')
const HeadersMessage = require('./headers')
const InvMessage = require('./inv')
const MempoolMessage = require('./mempool')
const PingMessage = require('./ping')
const PongMessage = require('./pong')
const RejectMessage = require('./reject')
const SendCmpctMessage = require('./sendcmpct')
const SendHeadersMessage = require('./sendheaders')
const TxMessage = require('./tx')
const VerackMessage = require('./verack')
const VersionMessage = require('./version')

Object.assign(exports, {
  addr: AddrMessage,
  block: BlockMessage,
  feefilter: FeeFilterMessage,
  getaddr: GetAddrMessage,
  getblocks: GetBlocksMessage,
  getdata: GetDataMessage,
  getheaders: GetHeadersMessage,
  headers: HeadersMessage,
  inv: InvMessage,
  mempool: MempoolMessage,
  ping: PingMessage,
  pong: PongMessage,
  reject: RejectMessage,
  sendcmpct: SendCmpctMessage,
  sendheaders: SendHeadersMessage,
  tx: TxMessage,
  verack: VerackMessage,
  version: VersionMessage
})
