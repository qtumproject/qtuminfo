const networks = new Map()

export default class Network {
  constructor({
    name,
    port, networkMagic,
    pubkeyhash, privatekey, scripthash, witnesshrp
  } = {}) {
    this.name = name
    this.port = port
    this.networkMagic = networkMagic
    this.pubkeyhash = pubkeyhash
    this.privatekey = privatekey
    this.scripthash = scripthash
    this.witnesshrp = witnesshrp
  }

  static add(options) {
    let network = new Network(options)
    networks.set(network.name, network)
  }

  static get(name) {
    return networks.get(name)
  }
}

Network.add({
  name: 'mainnet',
  port: 3888,
  networkMagic: Buffer.from([0xf1, 0xcf, 0xa6, 0xd3]),
  pubkeyhash: 0x3a,
  privatekey: 0x80,
  scripthash: 0x32,
  witnesshrp: 'qc'
})

Network.add({
  name: 'testnet',
  port: 13888,
  networkMagic: Buffer.from([0x0d, 0x22, 0x15, 0x06]),
  pubkeyhash: 0x78,
  privatekey: 0xef,
  scripthash: 0x6e,
  witnesshrp: 'tq'
})

Network.add({
  name: 'regtest',
  port: 23888,
  networkMagic: Buffer.from([0xfd, 0xdd, 0xc6, 0xe1]),
  pubkeyhash: 0x78,
  privatekey: 0xef,
  scripthash: 0x6e,
  witnesshrp: 'qcrt'
})
