import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let Receipt = sequelize.define('receipt', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    transactionId: {
      type: Sequelize.BIGINT.UNSIGNED,
      unique: 'transaction'
    },
    blockHeight: Sequelize.INTEGER.UNSIGNED,
    indexInBlock: Sequelize.INTEGER.UNSIGNED,
    outputIndex: {
      type: Sequelize.INTEGER.UNSIGNED,
      unique: 'transaction'
    },
    gasUsed: Sequelize.INTEGER.UNSIGNED,
    contractAddress: Sequelize.CHAR(20).BINARY,
    excepted: {
      type: Sequelize.ENUM,
      values: [
        'None', 'Unknown', 'BadRLP', 'InvalidFormat', 'OutOfGasIntrinsic', 'InvalidSignature', 'InvalidNonce',
        'NotEnoughCash', 'OutOfGasBase', 'BlockGasLimitReached', 'BadInstruction', 'BadJumpDestination',
        'OutOfGas', 'OutOfStack', 'StackUnderflow', 'CreateWithValue', 'NoInformation'
      ]
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ReceiptLog = sequelize.define('receipt_log', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    receiptId: Sequelize.BIGINT.UNSIGNED,
    logIndex: Sequelize.INTEGER.UNSIGNED,
    address: Sequelize.CHAR(20).BINARY,
    topic1: Sequelize.STRING(32).BINARY,
    topic2: Sequelize.STRING(32).BINARY,
    topic3: Sequelize.STRING(32).BINARY,
    topic4: Sequelize.STRING(32).BINARY,
    data: Sequelize.BLOB
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(Receipt, {as: 'receipts', foreignKey: 'transactionId'})
  Receipt.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId'})
  Receipt.hasMany(ReceiptLog, {as: 'logs', foreignKey: 'receiptId'})
  ReceiptLog.belongsTo(Receipt, {as: 'receipt', foreignKey: 'receiptId'})
}
