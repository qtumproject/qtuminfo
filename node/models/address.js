const Sequelize = require('sequelize')

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

function generate(sequelize) {
  let Address = sequelize.define('address', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    type: {
      type: Sequelize.INTEGER(3).UNSIGNED,
      get() {
        let type = this.getDataValue('type')
        return addressTypeMap[type] || null
      },
      set(type) {
        if (type != null) {
          this.setDataValue('type', addressTypes[type] || 0)
        }
      },
      unique: 'address'
    },
    data: {
      type: Sequelize.STRING(32).BINARY,
      unique: 'address'
    },
    string: Sequelize.STRING(64),
    createHeight: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})

  Address.getType = function(type) {
    return addressTypeMap[type] || null
  }
  Address.parseType = function(type) {
    return addressTypes[type] || 0
  }
}

module.exports = generate
