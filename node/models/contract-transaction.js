const Sequelize = require('sequelize')

function generate(sequelize) {
  let GasRefund = sequelize.define('gas_refund', {
    transactionId: {
      type: Sequelize.BIGINT.UNSIGNED,
      primaryKey: true
    },
    outputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    refundId: {
      type: Sequelize.BIGINT.UNSIGNED,
      unique: 'refund'
    },
    refundIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      unique: 'refund'
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ContractSpend = sequelize.define('contract_spend', {
    sourceId: {
      type: Sequelize.BIGINT.UNSIGNED,
      primaryKey: true
    },
    destId: Sequelize.BIGINT.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(GasRefund, {as: 'refunds', foreignKey: 'transactionId'})
  GasRefund.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId'})
  sequelize.models.transaction_output.hasOne(GasRefund, {as: 'refund', foreignKey: 'refundId'})
  GasRefund.belongsTo(sequelize.models.transaction_output, {as: 'refundTo', foreignKey: 'refundId'})
  sequelize.models.transaction.hasOne(ContractSpend, {as: 'contractSpendSource', foreignKey: 'sourceId'})
  ContractSpend.belongsTo(sequelize.models.transaction, {as: 'sourceTransaction', foreignKey: 'sourceId'})
  sequelize.models.transaction.hasMany(ContractSpend, {as: 'contractSpendDests', foreignKey: 'destId'})
  ContractSpend.belongsTo(sequelize.models.transaction, {as: 'destTransaction', foreignKey: 'destId'})
}

module.exports = generate
