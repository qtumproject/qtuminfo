import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let BalanceChange = sequelize.define('balance_change', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    transactionId: Sequelize.CHAR(32).BINARY,
    addressId: Sequelize.INTEGER.UNSIGNED,
    value: {
      type: Sequelize.BIGINT,
      get() {
        return BigInt(this.getDataValue('value'))
      },
      set(value) {
        return this.setDataValue('value', value.toString())
      }
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(BalanceChange, {as: 'balanceChanges', foreignKey: 'transactionId', sourceKey: 'id'})
  BalanceChange.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId', targetKey: 'id'})
  sequelize.models.address.hasOne(BalanceChange, {as: 'balanceChanges', foreignKey: 'addressId'})
  BalanceChange.belongsTo(sequelize.models.address, {as: 'address', foreignKey: 'addressId'})
}
