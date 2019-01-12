import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let Output = sequelize.define('output', {
    transactionId: {
      type: Sequelize.CHAR(32).BINARY,
      primaryKey: true
    },
    outputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    scriptPubKey: {type: Sequelize.BLOB, field: 'scriptpubkey'},
    value: {
      type: Sequelize.BIGINT,
      get() {
        return BigInt(this.getDataValue('value'))
      },
      set(value) {
        return this.setDataValue('value', value.toString())
      }
    },
    addressId: Sequelize.INTEGER.UNSIGNED,
    spent: Sequelize.BOOLEAN
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let Input = sequelize.define('input', {
    transactionId: {
      type: Sequelize.CHAR(32).BINARY,
      primaryKey: true
    },
    inputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    prevTxId: {type: Sequelize.CHAR(32).BINARY, field: 'prev_transaction_id'},
    outputIndex: Sequelize.INTEGER.UNSIGNED,
    scriptSig: {type: Sequelize.BLOB, field: 'scriptsig'},
    sequence: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(Output, {as: 'outputs', foreignKey: 'transactionId', sourceKey: 'id'})
  Output.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId', targetKey: 'id'})
  sequelize.models.transaction.hasMany(Input, {as: 'inputs', foreignKey: 'transactionId', sourceKey: 'id'})
  Input.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId', targetKey: 'id'})
  sequelize.models.address.hasMany(Output, {as: 'txos', foreignKey: 'addressId'})
  Output.belongsTo(sequelize.models.address, {as: 'address', foreignKey: 'addressId'})
  Output.hasOne(Input, {as: 'spend', foreignKey: 'prevTxId', sourceKey: 'transactionId'})
  Input.belongsTo(Output, {as: 'source', foreignKey: 'prevTxId', sourceKey: 'transactionId'})
}
