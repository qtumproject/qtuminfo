const Sequelize = require('sequelize')

function generate(sequelize) {
  let Transaction = sequelize.define('transaction', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    id: {
      type: Sequelize.CHAR(32).BINARY,
      unique: true
    },
    hash: Sequelize.CHAR(32).BINARY,
    version: Sequelize.INTEGER,
    flag: Sequelize.INTEGER(3).UNSIGNED,
    lockTime: Sequelize.INTEGER.UNSIGNED,
    blockHeight: Sequelize.INTEGER.UNSIGNED,
    indexInBlock: Sequelize.INTEGER.UNSIGNED,
    size: Sequelize.INTEGER.UNSIGNED,
    weight: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let Witness = sequelize.define('witness', {
    transactionId: {
      type: Sequelize.CHAR(32).BINARY,
      primaryKey: true
    },
    inputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    witnessIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    script: Sequelize.BLOB
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.block.hasMany(Transaction, {as: 'transactions', foreignKey: 'blockHeight'})
  Transaction.belongsTo(sequelize.models.block, {as: 'block', foreignKey: 'blockHeight'})
  Transaction.hasMany(Witness, {as: 'witnesses', foreignKey: 'transactionId', sourceKey: 'id'})
  Witness.belongsTo(Transaction, {foreignKey: 'transactionId', targetKey: 'id'})
}

module.exports = generate
