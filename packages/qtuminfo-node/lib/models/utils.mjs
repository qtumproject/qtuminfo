export const collectionMethods = [
  'aggregate',
  'bulkWrite',
  'countDocuments',
  'createIndex',
  'createIndexes',
  'deleteMany',
  'deleteOne',
  'distinct',
  'drop',
  'dropIndex',
  'dropIndexes',
  'estimatedDocumentCount',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndUpdate',
  'geoHaystackSearch',
  'indexes',
  'indexExists',
  'indexInformation',
  'initializeOrderedBulkOp',
  'initializeUnorderedBulkOp',
  'insertMany',
  'insertOne',
  'isCapped',
  'listIndexes',
  'mapReduce',
  'options',
  'parallelCollectionScan',
  'reIndex',
  'rename',
  'replaceOne',
  'stats',
  'updateMany',
  'updateOne',
  'watch'
]

export function wrapCollectionMethods(Model) {
  return new Proxy(Model, {
    get(target, name) {
      if (name in target) {
        return target[name]
      } else if (collectionMethods.includes(name)) {
        return target.collection[name].bind(target.collection)
      }
    }
  })
}
