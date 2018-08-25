import Block from '../models/block'
import Service from './base'

export default class StatisticsService extends Service {
  constructor(options) {
    super(options)
    this._tip = null
  }

  static get dependencies() {
    return ['block', 'db', 'header']
  }

  get APIMethods() {
    return {
      getDailyTransactions: this.getDailyTransactions.bind(this),
      getCoinstakeStatistics: this.getCoinstakeStatistics.bind(this)
    }
  }

  async getDailyTransactions() {
    return await Block.aggregate([
      {
        $group: {
          _id: {$floor: {$divide: ['$timestamp', 86400]}},
          count: {$sum: '$transactionCount'}
        }
      },
      {
        $project: {
          _id: false,
          timestamp: '$_id',
          count: '$count'
        }
      },
      {$sort: {timestamp: 1}}
    ])
  }

  async getCoinstakeStatistics() {
    let splitPoints = []
    for (let i = 0; i <= 35; ++i) {
      splitPoints.push(10 ** (i / 5 - 1))
    }
    let facets = {}
    for (let i = 0; i < splitPoints.length; ++i) {
      facets[i] = [
        {$match: {coinstakeValue: {$lt: splitPoints[i] * 1e8}}},
        {$count: 'count'}
      ]
    }
    let [queryResult] = await Block.aggregate([
      {$match: {height: {$gt: 5000}}},
      {$facet: facets}
    ])
    let list = [{maximum: 0, count: 0}]
    for (let i = 0; i < splitPoints.length; ++i) {
      list.push({maximum: splitPoints[i], count: queryResult[i][0] ? queryResult[i][0].count : 0})
    }
    list.push({maximum: Infinity, count: this.node.getBlockTip().height - 5000})
    let result = []
    for (let i = 1; i < list.length; ++i) {
      result[i] = {
        minimum: list[i - 1].maximum,
        maximum: list[i].maximum,
        count: list[i].count - list[i - 1].count
      }
    }
    result.shift()
    return result
  }
}
