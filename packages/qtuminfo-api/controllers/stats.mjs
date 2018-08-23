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
    ctx.body = this._cache.dailyTransactions.map(({timestamp, count}) => ({
      time: new Date(timestamp * 86400 * 1000),
      transactions: count
    }))
  }

  async coinstake(ctx) {
    if (!('coinstake' in this._cache)) {
      this._cache.coinstake = await this.node.getCoinstakeStatistics()
    }
    ctx.body = this._cache.coinstake
  }

  async addressGrowth(ctx) {
    if (!('coinstake' in this._cache)) {
      this._cache.addressGrowth = await this.node.getAddressGrowth()
    }
    ctx.body = this._cache.addressGrowth.map(({timestamp, count}) => ({
      time: new Date(timestamp * 86400 * 1000),
      addresses: count
    }))
  }

  async _runCache() {
    if (!('dailyTransactions' in this._cache)) {
      this._cache.dailyTransactions = await this.node.getDailyTransactions()
    }
    this._cache.dailyTransactions = await this.node.getDailyTransactions()
    this._cache.coinstake = await this.node.getCoinstakeStatistics()
    this._cache.addressGrowth = await this.node.getAddressGrowth()
  }
}
