import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let GasRefund = sequelize.define('gas_refund', {
    transactionId: {
      type: Sequelize.CHAR(32).BINARY,
      primaryKey: true
    },
    outputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    refundTxId: {
      type: Sequelize.CHAR(32).BINARY,
      field: 'refund_transaction_id',
      unique: 'refund'
    },
    refundIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      unique: 'refund'
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ContractSpend = sequelize.define('contract_spend', {
    sourceTxId: {
      type: Sequelize.CHAR(32).BINARY,
      field: 'source_id',
      primaryKey: true
    },
    destTxId: {type: Sequelize.CHAR(32).BINARY, field: 'dest_id'}
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(GasRefund, {as: 'refunds', foreignKey: 'transactionId', sourceKey: 'id'})
  GasRefund.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId', targetKey: 'id'})
  sequelize.models.output.hasOne(GasRefund, {as: 'utxo', foreignKey: 'refundTxId', sourceKey: 'transactionId'})
  GasRefund.belongsTo(sequelize.models.output, {as: 'refund', foreignKey: 'refundTxId', targetKey: 'transactionId'})
  sequelize.models.transaction.hasOne(ContractSpend, {as: 'contractSpendSource', foreignKey: 'sourceTxId', sourceKey: 'id'})
  ContractSpend.belongsTo(sequelize.models.transaction, {as: 'sourceTransaction', foreignKey: 'sourceTxId', targetKey: 'id'})
  sequelize.models.transaction.hasMany(ContractSpend, {as: 'contractSpendDests', foreignKey: 'destTxId', sourceKey: 'id'})
  ContractSpend.belongsTo(sequelize.models.transaction, {as: 'destTransaction', foreignKey: 'destTxId', targetKey: 'id'})
}
