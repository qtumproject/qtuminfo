import Sequelize from 'sequelize'

/* eslint-disable camelcase */
const addressTypes = {
  pubkeyhash: 1,
  scripthash: 2,
  witness_v0_keyhash: 3,
  witness_v0_scripthash: 4,
  contract: 0x80,
  evm_contract: 0x81,
  x86_contract: 0x82
}
/* eslint-enable camelcase*/
const addressTypeMap = {
  1: 'pubkeyhash',
  2: 'scripthash',
  3: 'witness_v0_keyhash',
  4: 'witness_v0_scripthash',
  0x80: 'contract',
  0x81: 'evm_contract',
  0x82: 'x86_contract'
}

export default function generate(sequelize) {
  let EVMReceipt = sequelize.define('evm_receipt', {
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
    senderType: {
      type: Sequelize.INTEGER(3).UNSIGNED,
      get() {
        let senderType = this.getDataValue('senderType')
        return addressTypeMap[senderType] || null
      },
      set(senderType) {
        if (senderType != null) {
          this.setDataValue('senderType', addressTypes[senderType] || 0)
        }
      }
    },
    senderData: Sequelize.STRING(32).BINARY,
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

  let EVMReceiptLog = sequelize.define('evm_receipt_log', {
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

  sequelize.models.transaction.hasMany(EVMReceipt, {as: 'evmReceipts', foreignKey: 'transactionId'})
  EVMReceipt.belongsTo(sequelize.models.transaction, {as: 'transaction', foreignKey: 'transactionId'})
  EVMReceipt.hasMany(EVMReceiptLog, {as: 'logs', foreignKey: 'receiptId'})
  EVMReceiptLog.belongsTo(EVMReceipt, {as: 'receipt', foreignKey: 'receiptId'})
}
