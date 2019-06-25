const Sequelize = require('sequelize')

function generate(sequelize) {
  let Contract = sequelize.define('contract', {
    address: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    addressString: Sequelize.CHAR(34),
    vm: {
      type: Sequelize.ENUM,
      values: ['evm', 'x86']
    },
    type: {
      type: Sequelize.ENUM,
      values: ['dgp', 'qrc20', 'qrc721'],
      allowNull: true
    },
    bytecodeSha256sum: Sequelize.CHAR(32).BINARY,
    description: {
      type: Sequelize.TEXT,
      defaultValue: ''
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let ContractCode = sequelize.define('contract_code', {
    sha256sum: {
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

  Contract.hasOne(ContractCode, {as: 'code', foreignKey: 'contractAddress'})
  ContractCode.belongsTo(Contract, {as: 'contract', foreignKey: 'contractAddress'})
  Contract.hasMany(ContractTag, {as: 'tags', foreignKey: 'contractAddress'})
  ContractTag.belongsTo(Contract, {as: 'contract', foreignKey: 'contractAddress'})
}

module.exports = generate
