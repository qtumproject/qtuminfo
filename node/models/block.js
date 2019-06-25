const Sequelize = require('sequelize')

function generate(sequelize) {
  let Block = sequelize.define('block', {
    hash: {
      type: Sequelize.CHAR(32).BINARY,
      unique: true
    },
    height: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    size: Sequelize.INTEGER.UNSIGNED,
    weight: Sequelize.INTEGER.UNSIGNED,
    minerId: Sequelize.BIGINT.UNSIGNED,
    transactionsCount: Sequelize.INTEGER.UNSIGNED,
    contractTransactionsCount: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.header.hasOne(Block, {foreignKey: 'height'})
  Block.belongsTo(sequelize.models.header, {foreignKey: 'height'})
  Block.hasOne(sequelize.models.address, {as: 'miner', foreignKey: 'minerId'})
  sequelize.models.address.hasOne(Block, {as: 'minedBlocks', foreignKey: 'minerId'})
}

module.exports = generate
