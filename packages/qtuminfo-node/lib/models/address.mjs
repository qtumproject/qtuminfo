import Sequelize from 'sequelize'

export default function generate(sequelize) {
  sequelize.define('address', {
    _id: {
      type: Sequelize.BIGINT.UNSIGNED,
      field: '_id',
      primaryKey: true,
      autoIncrement: true
    },
    type: {
      type: Sequelize.ENUM,
      values: [
        'pubkeyhash', 'scripthash',
        'witness_v0_keyhash', 'witness_v0_scripthash',
        'contract', 'evm_contract', 'x86_contract'
      ],
      unique: 'address'
    },
    data: {
      type: Sequelize.STRING(32).BINARY,
      unique: 'address'
    },
    string: Sequelize.STRING(64),
    createHeight: Sequelize.INTEGER.UNSIGNED,
    createIndex: Sequelize.INTEGER.UNSIGNED
  }, {freezeTableName: true, underscored: true, timestamps: false})
}
