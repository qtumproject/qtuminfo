const Sequelize = require('sequelize')

function generate(sequelize) {
  let TransactionOutput = sequelize.define('transaction_output', {
    transactionId: {
      type: Sequelize.BIGINT.UNSIGNED,
      primaryKey: true
    },
    outputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    scriptPubKey: {
      type: Sequelize.BLOB('medium'),
      field: 'scriptpubkey',
    },
    blockHeight: Sequelize.INTEGER.UNSIGNED,
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
    isStake: Sequelize.BOOLEAN,
    inputId: Sequelize.BIGINT.UNSIGNED,
    inputIndex: Sequelize.INTEGER.UNSIGNED,
    inputHeight: {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let TransactionInput = sequelize.define('transaction_input', {
    transactionId: {
      type: Sequelize.BIGINT.UNSIGNED,
      primaryKey: true
    },
    inputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    scriptSig: {
      type: Sequelize.BLOB('medium'),
      field: 'scriptsig'
    },
    sequence: Sequelize.INTEGER.UNSIGNED,
    blockHeight: Sequelize.INTEGER.UNSIGNED,
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
    outputId: Sequelize.BIGINT.UNSIGNED,
    outputIndex: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.define('transaction_output_mapping', {
    _id: {
      type: Sequelize.CHAR(32),
      field: '_id'
    },
    inputTxId: {
      type: Sequelize.STRING(32).BINARY,
      field: 'input_transaction_id'
    },
    inputIndex: Sequelize.INTEGER.UNSIGNED,
    outputTxId: {
      type: Sequelize.STRING(32).BINARY,
      field: 'output_transaction_id'
    },
    outputIndex: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  TransactionOutput.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId'})
  TransactionInput.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId'})
  TransactionInput.belongsTo(sequelize.models.address, {as: 'address', foreignKey: 'addressId'})
}

module.exports = generate
