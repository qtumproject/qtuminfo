import AddrMessage from './addr'
import BlockMessage from './block'
import FeeFilterMessage from './feefilter'
import GetBlocksMessage from './getblocks'
import GetDataMessage from './getdata'
import GetHeadersMessage from './getheaders'
import HeadersMessage from './headers'
import InvMessage from './inv'
import MempoolMessage from './mempool'
import PingMessage from './ping'
import PongMessage from './pong'
import RejectMessage from './reject'
import SendCmpctMessage from './sendcmpct'
import SendHeadersMessage from './sendheaders'
import TxMessage from './tx'
import VerackMessage from './verack'
import VersionMessage from './version'

export const messageMap = {
  addr: AddrMessage,
  block: BlockMessage,
  feefilter: FeeFilterMessage,
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
}
