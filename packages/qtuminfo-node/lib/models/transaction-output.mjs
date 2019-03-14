import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let TransactionOutput = sequelize.define('transaction_output', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true
    },
    outputTxId: {
      type: Sequelize.STRING(32).BINARY,
      field: 'output_transaction_id',
      primaryKey: true
    },
    outputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    scriptPubKey: {
      type: Sequelize.BLOB('medium'),
      field: 'scriptpubkey',
      allowNull: true
    },
    outputHeight: {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    },
    inputTxId: {
      type: Sequelize.STRING(32).BINARY,
      field: 'input_transaction_id',
      allowNull: true
    },
    inputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    },
    scriptSig: {
      type: Sequelize.BLOB('medium'),
      field: 'scriptsig',
      allowNull: true
    },
    sequence: {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    },
    inputHeight: {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
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
    },
    addressId: Sequelize.BIGINT.UNSIGNED,
    isStake: Sequelize.BOOLEAN
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(TransactionOutput, {as: 'outputs', foreignKey: 'outputTxId', sourceKey: 'id'})
  TransactionOutput.belongsTo(sequelize.models.transaction, {as: 'outputTransaction', foreignKey: 'outputTxId', targetKey: 'id'})
  sequelize.models.transaction.hasMany(TransactionOutput, {as: 'inputs', foreignKey: 'inputTxId', sourceKey: 'id'})
  TransactionOutput.belongsTo(sequelize.models.transaction, {as: 'inputTransaction', foreignKey: 'inputTxId', targetKey: 'id'})
  sequelize.models.address.hasMany(TransactionOutput, {as: 'txos', foreignKey: 'addressId'})
  TransactionOutput.belongsTo(sequelize.models.address, {as: 'address', foreignKey: 'addressId'})
}
