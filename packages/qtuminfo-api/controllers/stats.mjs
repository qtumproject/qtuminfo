export default class StatsContoller {
  constructor(node) {
    this.node = node
  }

  async dailyTransactions(ctx) {
    let list = await this.node.getDailyTransactions()
    ctx.body = list.map(({timestamp, count}) => {
      let time = new Date(timestamp * 86400 * 1000)
      let year = time.getUTCFullYear()
      let month = time.getUTCMonth() + 1
      let date = time.getUTCDate()
      return {
        date: `${year}-${month.toString().padStart(2, '0')}-${date.toString().padStart(2, '0')}`,
        time,
        transactions: count
      }
    })
  }

  async coinstake(ctx) {
    ctx.body = await this.node.getCoinstakeStatistics()
  }
}
