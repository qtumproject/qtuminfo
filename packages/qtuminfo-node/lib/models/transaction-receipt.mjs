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
      type: Sequelize.CHAR(32).BINARY,
      unique: 'transaction'
    },
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
    contractAddress: Sequelize.CHAR(20).BINARY,
    data: Sequelize.BLOB
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ReceiptTopic = sequelize.define('receipt_topic', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    logId: Sequelize.BIGINT.UNSIGNED,
    topicIndex: Sequelize.INTEGER.UNSIGNED,
    topic: Sequelize.BLOB
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.transaction.hasMany(Receipt, {as: 'receipts', foreignKey: 'transactionId', sourceKey: 'id'})
  Receipt.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId', targetKey: 'id'})
  Receipt.hasMany(ReceiptLog, {as: 'logs', foreignKey: 'receiptId'})
  ReceiptLog.belongsTo(Receipt, {as: 'receipt', foreignKey: 'receiptId'})
  ReceiptLog.hasMany(ReceiptTopic, {as: 'topics', foreignKey: 'logId'})
  ReceiptTopic.belongsTo(ReceiptLog, {as: 'log', foreignKey: 'logId'})
}
