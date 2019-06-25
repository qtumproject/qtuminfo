const Sequelize = require('sequelize')

function generate(sequelize) {
  sequelize.define('tip', {
    service: {
      type: Sequelize.STRING,
      primaryKey: true
    },
    height: Sequelize.INTEGER.UNSIGNED,
    hash: Sequelize.CHAR(32).BINARY
  }, {freezeTableName: true, underscored: true, timestamps: false})
}

module.exports = generate
