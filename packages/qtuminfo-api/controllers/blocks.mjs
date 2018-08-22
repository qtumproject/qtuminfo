export default class BlocksController {
  constructor(node) {
    this.node = node
  }

  async block(ctx) {
    let block = ctx.params.block
    if (/^(0|[1-9]\d{0,9})$/.test(block)) {
      block = Number(block)
    } else if (/^[0-9a-f]{64}$/.test(block)) {
      block = Buffer.from(block, 'hex')
    } else {
      ctx.throw(404)
    }
    block = await this.node.getBlock(block)
    if (block) {
      let reward = await this.node.getBlockReward(block.height, block.isProofOfStake)
      let duration
      if (block.height !== 0) {
        duration = block.timestamp - (await this.node.getBlockHeader(block.prevHash)).timestamp
      }
      ctx.body = {
        hash: block.hash.toString('hex'),
        height: block.height,
        version: block.version,
        prevHash: block.prevHash.toString('hex'),
        nextHash: block.nextHash && block.nextHash.toString('hex'),
        merkleRoot: block.merkleRoot.toString('hex'),
        timestamp: block.timestamp,
        bits: block.bits,
        nonce: block.nonce,
        hashStateRoot: block.hashStateRoot.toString('hex'),
        hashUTXORoot: block.hashUTXORoot.toString('hex'),
        prevOutStakeHash: block.prevOutStakeHash.toString('hex'),
        prevOutStakeN: block.prevOutStakeN,
        signature: block.signature.toString('hex'),
        chainwork: block.chainwork.toString(16).padStart(64, '0'),
        size: block.size,
        weight: block.weight,
        transactions: block.transactions.map(id => id.toString('hex')),
        miner: block.miner.toString(),
        coinstakeValue: block.coinstakeValue && block.coinstakeValue.toString(),
        difficulty: block.difficulty,
        reward: reward.toString(),
        duration,
        confirmations: this.node.getBlockTip().height - block.height + 1
      }
    } else {
      ctx.throw(404)
    }
  }

  async rawBlock(ctx) {
    let hash = ctx.params.hash
    if (/^[0-9a-f]{64}$/.test(hash)) {
      let block = await this.node.getRawBlock(Buffer.from(hash, 'hex'))
      if (block) {
        ctx.body = block.toBuffer().toString('hex')
      }
    }
    ctx.throw(404)
  }

  async list(ctx) {
    let date = ctx.query.date || formatTimestamp(new Date())
    let min = Math.floor(Date.parse(date) / 1000)
    let max = min + 24 * 60 * 60
    let blocks = await this.node.getBlocksByTimestamp({min, max})
    ctx.body = await this._getBlocksSummary(blocks)
  }

  async recentBlocks(ctx) {
    let count = Number.parseInt(ctx.query.count || 10)
    let blocks = await this.node.getRecentBlocks(count)
    ctx.body = (await this._getBlocksSummary(blocks.reverse())).reverse()
  }

  async _getBlocksSummary(blocks) {
    if (blocks.length === 0) {
      return []
    }
    blocks = await Promise.all(blocks.map(async block => {
      let reward = await this.node.getBlockReward(block.height, block.isProofOfStake)
      return {
        hash: block.hash.toString('hex'),
        height: block.height,
        timestamp: block.timestamp,
        transactionCount: block.transactionCount,
        size: block.size,
        miner: block.miner.toString(),
        reward: reward.toString()
      }
    }))
    for (let i = 1; i < blocks.length; ++i) {
      blocks[i].duration = blocks[i].timestamp - blocks[i - 1].timestamp
    }
    if (blocks[0].height !== 0) {
      blocks[0].duration = blocks[0].timestamp - (await this.node.getBlockHeader(blocks[0].height - 1)).timestamp
    }
    return blocks
  }
}

function formatTimestamp(date) {
  let yyyy = date.getUTCFullYear().toString()
  let mm = (date.getUTCMonth() + 1).toString()
  let dd = date.getUTCDate().toString()
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}
