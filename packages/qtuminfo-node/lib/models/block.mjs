import Sequelize from 'sequelize'

export default function generate(sequelize) {
  let Block = sequelize.define('block', {
    hashString: {
      type: Sequelize.CHAR(64),
      unique: true
    },
    height: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    size: Sequelize.INTEGER.UNSIGNED,
    weight: Sequelize.INTEGER.UNSIGNED
    // miner
  }, {
    freezeTableName: true, underscored: true, timestamps: false,
    getterMethods: {
      hash() {
        return Buffer.from(this.hashString, 'hex')
      }
    },
    setterMethods: {
      hash(value) {
        this.setDataValue('hashString', value.toString('hex'))
      }
    }
  }, {freezeTableName: true, underscored: true, timestamps: false})

  sequelize.models.header.hasOne(Block, {foreignKey: 'height'})
  Block.belongsTo(sequelize.models.header, {foreignKey: 'height'})
}
