import {wrapCollectionMethods} from './utils'

class Info {
  constructor(key, value) {
    this.key = key
    this.value = value
  }

  static async init(db) {
    Info.collection = db.collection('infos')
    await Info.collection.createIndex({key: 1}, {unique: true})
  }
}

export default wrapCollectionMethods(Info)
