import dns from 'dns'
import EventEmitter from 'events'
import Peer from './peer'
import {messageMap} from './commands/commands'

const MAX_CONNECTED_PEERS = 8
const RETRY_SECONDS = 30

export default class Pool extends EventEmitter {
  constructor({network, addresses = [], dnsSeed, maxSize = MAX_CONNECTED_PEERS}) {
    super()
    this.network = network
    this.keepAlive = false
    this.connectedPeers = new Map()
    this.addresses = []
    this.dnsSeed = dnsSeed
    this.maxSize = maxSize
    for (let address of addresses) {
      this.addAddress(address)
    }

    this.on('seed', ips => {
      for (let ip of ips) {
        this.addAddress({ip: {v4: ip}})
      }
      if (this.keepAlive) {
        this.fillConnections()
      }
    })
    this.on('peerdisconnect', (peer, address) => {
      this.deprioritizeAddress(address)
      this.removeConnectedPeer(address)
      if (this.keepAlive) {
        this.fillConnections()
      }
    })
  }

  connect() {
    this.keepAlive = true
    if (this.dnsSeed) {
      this.addAddressesFromSeeds()
    } else {
      this.fillConnections()
    }
  }

  disconnect() {
    this.keepAlive = false
    for (let peer of this.connectedPeers.values()) {
      peer.disconnect()
    }
  }

  get connections() {
    return this.connectedPeers.size
  }

  fillConnections() {
    for (let address of this.addresses) {
      if (this.connectedPeers.length >= this.maxSize) {
        break
      }
      if (!address.retryTime || Math.floor(Date.now() / 1000) > address.retryTime) {
        this.connectPeer(address)
      }
    }
  }

  removeConnectedPeer(address) {
    if (this.connectedPeers.get(address.id).status === Peer.STATUS.DISCONNECTED) {
      this.connectedPeers.delete(address.id)
    } else {
      this.connectedPeers.get(address.id).disconnect()
    }
  }

  connectPeer(address) {
    if (!this.connectedPeers.has(address.id)) {
      let port = address.port || this.network.port
      let ip = address.ip.v4 || address.ip.v6
      let peer = new Peer({host: ip, port, network: this.network})
      peer.on('connect', () => this.emit('peerconnect', peer, address))
      this.addPeerEventHandlers(peer, address)
      peer.connect()
      this.connectedPeers.set(address.id, peer)
    }
  }

  addConnectedPeer(socket, address) {
    if (!this.connectedPeers.has(address.id)) {
      let peer = new Peer({socket, network: this.network})
      this.addPeerEventHandlers(peer, address)
      this.connectedPeers.set(address.id, peer)
      this.emit('peerconnect', peer, address)
    }
  }

  addPeerEventHandlers(peer, address) {
    peer.on('disconnnect', () => this.emit('peerdisconnect', peer, address))
    peer.on('ready', () => this.emit('peerready', peer, address))
    for (let event of Object.keys(messageMap)) {
      peer.on(event, message => this.emit(`peer${event}`, peer, message))
    }
  }

  deprioritizeAddress(address) {
    let index = this.addresses.findIndex(item => item.id === address.id)
    if (index >= 0) {
      let [item] = this.addresses.splice(index, 1)
      item.retryTime = Math.floor(Date.now() / 1000) + RETRY_SECONDS
      this.addresses.push(item)
    }
  }

  addAddress(address) {
    address.port = address.port || this.network.port
    address.id = `${address.ip.v6 || address.ip.v4 || ''}:${address.port}`
    if (!this.addresses.find(item => item.id === address.id)) {
      this.addresses.unshift(address)
    }
    return address
  }

  addAddressesFromSeed(seed) {
    dns.resolve(seed, (err, ips) => {
      if (err) {
        this.emit('seederror', err)
      } else {
        this.emit('seed', ips)
      }
    })
  }

  addAddressesFromSeeds() {
    for (let seed of this.network.dnsSeeds) {
      this.addAddressesFromSeed(seed)
    }
  }
}
