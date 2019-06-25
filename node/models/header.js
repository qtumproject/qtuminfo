const Sequelize = require('sequelize')

function generate(sequelize) {
  let Header = sequelize.define('header', {
    hash: {
      type: Sequelize.CHAR(32).BINARY,
      unique: true
    },
    height: {
      type: Sequelize.INTEGER.UNSIGNED,
      primaryKey: true
    },
    version: Sequelize.INTEGER,
    prevHash: {
      type: Sequelize.CHAR(32).BINARY,
      defaultValue: Buffer.alloc(32)
    },
    merkleRoot: Sequelize.CHAR(32).BINARY,
    timestamp: Sequelize.INTEGER.UNSIGNED,
    bits: Sequelize.INTEGER.UNSIGNED,
    nonce: Sequelize.INTEGER.UNSIGNED,
    hashStateRoot: Sequelize.CHAR(32).BINARY,
    hashUTXORoot: {type: Sequelize.CHAR(32).BINARY, field: 'hash_utxo_root'},
    stakePrevTxId: {type: Sequelize.CHAR(32).BINARY, field: 'stake_prev_transaction_id'},
    stakeOutputIndex: Sequelize.INTEGER.UNSIGNED,
    signature: Sequelize.BLOB,
    chainwork: {
      type: Sequelize.CHAR(32).BINARY,
      get() {
        return BigInt(`0x${this.getDataValue('chainwork').toString('hex')}`)
      },
      set(value) {
        return this.setDataValue(
          'chainwork',
          Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
        )
      }
    }
  }, {
    freezeTableName: true, underscored: true, timestamps: false,
    getterMethods: {
      difficulty() {
        function getTargetDifficulty(bits) {
          return (bits & 0xffffff) * 2 ** ((bits >>> 24) - 3 << 3)
        }
        return getTargetDifficulty(0x1d00ffff) / getTargetDifficulty(this.bits)
      }
    }
  })

  Header.findByHeight = function findByHeight(height, options = {}) {
    return Header.findOne({where: {height}, ...options})
  }
  Header.findByHash = function findByHash(hash, options = {}) {
    return Header.findOne({where: {hash}, ...options})
  }
  Header.prototype.isProofOfStake = function isProofOfStake() {
    return Buffer.compare(this.stakePrevTxId, Buffer.alloc(32)) !== 0 && this.stakeOutputIndex !== 0xffffffff
  }
}

module.exports = generate
