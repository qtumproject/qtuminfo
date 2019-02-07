import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let QRC20 = sequelize.define('qrc20', {
    contractAddress: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    name: Sequelize.BLOB,
    symbol: Sequelize.BLOB,
    decimals: Sequelize.INTEGER(3).UNSIGNED,
    totalSupply: {
      type: Sequelize.CHAR(32).BINARY,
      get() {
        return BigInt(`0x${this.getDataValue('totalSupply').toString('hex')}`)
      },
      set(value) {
        return this.setDataValue(
          'totalSupply',
          Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
        )
      }
    },
    version: {
      type: Sequelize.BLOB,
      allowNull: true
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let QRC20Balance = sequelize.define('qrc20_balance', {
    contractAddress: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    address: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    balance: {
      type: Sequelize.CHAR(32).BINARY,
      get() {
        return BigInt(`0x${this.getDataValue('balance').toString('hex')}`)
      },
      set(value) {
        return this.setDataValue(
          'balance',
          Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
        )
      }
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let Qrc721 = sequelize.define('qrc721', {
    contractAddress: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    name: Sequelize.BLOB,
    symbol: Sequelize.BLOB,
    totalSupply: {
      type: Sequelize.CHAR(32).BINARY,
      get() {
        return BigInt(`0x${this.getDataValue('totalSupply').toString('hex')}`)
      },
      set(value) {
        return this.setDataValue(
          'totalSupply',
          Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
        )
      }
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  let QRC721Token = sequelize.define('qrc721_token', {
    contractAddress: {
      type: Sequelize.CHAR(20).BINARY,
      primaryKey: true
    },
    tokenId: {
      type: Sequelize.CHAR(32).BINARY,
      primaryKey: true
    },
    holder: Sequelize.CHAR(20).BINARY
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.contract.hasOne(QRC20, {as: 'qrc20', foreignKey: 'contractAddress'})
  QRC20.belongsTo(sequelize.models.contract, {as: 'contract', foreignKey: 'contractAddress'})
  sequelize.models.contract.hasMany(QRC20Balance, {as: 'qrc20Balances', foreignKey: 'contractAddress'})
  QRC20Balance.belongsTo(sequelize.models.contract, {as: 'contract', foreignKey: 'contractAddress'})
  sequelize.models.contract.hasOne(Qrc721, {as: 'qrc721', foreignKey: 'contractAddress'})
  Qrc721.belongsTo(sequelize.models.contract, {as: 'contract', foreignKey: 'contractAddress'})
  sequelize.models.contract.hasMany(QRC721Token, {as: 'qrc721Tokens', foreignKey: 'contractAddress'})
  QRC721Token.belongsTo(sequelize.models.contract, {as: 'contract', foreignKey: 'contractAddress'})
}
