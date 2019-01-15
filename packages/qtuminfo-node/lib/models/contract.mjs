import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let Contract = sequelize.define('contract', {
    address: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    addressString: Sequelize.CHAR(40),
    vm: {
      type: Sequelize.ENUM,
      values: ['evm', 'x86']
    },
    type: {
      type: Sequelize.ENUM,
      values: ['dgp', 'qrc20', 'qrc721'],
      allowNull: true
    },
    description: {
      type: Sequelize.TEXT,
      defaultValue: ''
    },
    ownerId: {
      type: Sequelize.BIGINT.UNSIGNED,
      defaultValue: '0'
    },
    createTxId: {
      type: Sequelize.STRING(32).BINARY,
      field: 'create_transaction_id',
      allowNull: true
    },
    createHeight: {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ContractCode = sequelize.define('contract_code', {
    contractAddress: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    code: Sequelize.BLOB,
    source: {
      type: Sequelize.TEXT('long'),
      allowNull: true
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ContractTag = sequelize.define('contract_tag', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true
    },
    contractAddress: Sequelize.CHAR(20).BINARY,
    tag: Sequelize.STRING(32)
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.address.hasOne(Contract, {as: 'createdContracts', foreignKey: 'ownerId'})
  Contract.belongsTo(sequelize.models.address, {as: 'owner', foreignKey: 'ownerId'})
  Contract.hasOne(ContractCode, {as: 'code', foreignKey: 'contractAddress'})
  ContractCode.belongsTo(Contract, {as: 'contract', foreignKey: 'contractAddress'})
  Contract.hasMany(ContractTag, {as: 'tags', foreignKey: 'contractAddress'})
  ContractTag.belongsTo(Contract, {as: 'contract', foreignKey: 'contractAddress'})
}
