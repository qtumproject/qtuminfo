const Sequelize = require('sequelize')

function generate(sequelize) {
  let BalanceChange = sequelize.define('balance_change', {
    transactionId: {
      type: Sequelize.BIGINT.UNSIGNED,
      primaryKey: true
    },
    blockHeight: Sequelize.INTEGER.UNSIGNED,
    indexInBlock: Sequelize.INTEGER.UNSIGNED,
    addressId: {
      type: Sequelize.BIGINT.UNSIGNED,
      primaryKey: true
    },
    value: {
      type: Sequelize.BIGINT,
      get() {
        let value = this.getDataValue('value')
        return value == null ? null : BigInt(value)
      },
      set(value) {
        if (value != null) {
          this.setDataValue('value', value.toString())
        }
      }
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(BalanceChange, {as: 'balanceChanges', foreignKey: 'transactionId'})
  BalanceChange.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId'})
  sequelize.models.address.hasOne(BalanceChange, {as: 'balanceChanges', foreignKey: 'addressId'})
  BalanceChange.belongsTo(sequelize.models.address, {as: 'address', foreignKey: 'addressId'})
}

module.exports = generate
