export default class StatsContoller {
  constructor(node) {
    this.node = node
    this._cache = {}
    this._runCache()
    setInterval(this._runCache.bind(this), 600 * 1000).unref()
  }

  async dailyTransactions(ctx) {
    if (!('dailyTransactions' in this._cache)) {
      this._cache.dailyTransactions = await this.node.getDailyTransactions()
    }
    ctx.body = this._cache.dailyTransactions.map(({timestamp, transactionCount, contractTransactionCount}) => ({
      time: new Date(timestamp * 86400 * 1000),
      transactionCount, contractTransactionCount
    }))
  }

  async blockInterval(ctx) {
    if (!('blockInterval' in this._cache)) {
      this._cache.blockInterval = await this.node.getBlockIntervalStatistics()
    }
    ctx.body = this._cache.blockInterval
  }

  async coinstake(ctx) {
    if (!('coinstake' in this._cache)) {
      this._cache.coinstake = await this.node.getCoinstakeStatistics()
    }
    ctx.body = this._cache.coinstake
  }

  async addressGrowth(ctx) {
    if (!('addressGrowth' in this._cache)) {
      this._cache.addressGrowth = await this.node.getAddressGrowth()
    }
    ctx.body = this._cache.addressGrowth.map(({timestamp, count}) => ({
      time: new Date(timestamp * 86400 * 1000),
      addresses: count
    }))
  }

  _runCache() {
    try {
      this.node.getDailyTransactions().then(result => {this._cache.dailyTransactions = result})
      this.node.getBlockIntervalStatistics().then(result => {this._cache.blockInterval = result})
      this.node.getCoinstakeStatistics().then(result => {this._cache.coinstake = result})
      this.node.getAddressGrowth().then(result => {this._cache.addressGrowth = result})
    } catch (err) {}
  }
}
