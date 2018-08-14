import ethjsABI from 'ethereumjs-abi'
import qrc20List from './qrc20-abi.json'
import qrc721List from './qrc721-abi.json'

function getTypes(abi, category) {
  let result = []
  for (let item of abi[category]) {
    if (item.type === 'tuple') {
      result.push(`(${getTypes({[category]: item.components}).join(',')})`)
    } else {
      result.push(item.type)
    }
  }
  return result
}

export class MethodABI {
  constructor({type = 'function', name, stateMutability, inputs = [], outputs = []}) {
    this.type = type
    this.name = name
    this.stateMutability = stateMutability
    this.inputs = inputs
    this.outputs = outputs
  }

  get id() {
    this._id = this._id || ethjsABI.methodID(this.name, getTypes(this, 'inputs'))
    return this._id
  }

  encodeInputs(params) {
    return ethjsABI.rawEncode(getTypes(this, 'inputs'), params)
  }

  decodeInputs(data) {
    return ethjsABI.rawDecode(getTypes(this, 'inputs'), data)
  }

  encodeOutputs(params) {
    return ethjsABI.rawEncode(getTypes(this, 'outputs'), params)
  }

  decodeOutputs(data) {
    return ethjsABI.rawDecode(getTypes(this, 'outputs'), data)
  }
}

export class EventABI {
  constructor({name, anonymous = false, inputs = []}) {
    this.type = 'event'
    this.name = name
    this.anonymous = anonymous
    this.inputs = inputs
  }

  get id() {
    this._id = this._id || ethjsABI.eventID(this.name, getTypes(this, 'inputs'))
    return this._id
  }

  encode(params) {
    let topics = []
    let unindexedInputs = this.inputs.filter(input => !input.indexed)
    let unindexedParams = []
    for (let index = 0; index < this.inputs.length; ++index) {
      let input = this.inputs[index]
      if (input.indexed) {
        topics.push(ethjsABI.rawEncode(
          getTypes({inputs: [input]}, 'inputs'),
          [params[index]]
        ))
      } else {
        unindexedInputs.push(input)
        unindexedParams.push(params[index])
      }
    }
    let data = ethjsABI.rawEncode(
      getTypes({inputs: unindexedInputs}, 'inputs'),
      unindexedParams
    )
    return {topics, data}
  }

  decode({topics, data}) {
    let indexedInputs = this.inputs.filter(input => input.indexed)
    let unindexedInputs = this.inputs.filter(input => !input.indexed)
    let indexedParams = []
    for (let index = 0; index < topics.length; ++index) {
      let input = indexedInputs[index]
      let [param] = ethjsABI.rawDecode(getTypes({inputs: [input]}, 'inputs'), topics[index])
      indexedParams.push(param)
    }
    let unindexedParams = ethjsABI.rawDecode(getTypes({inputs: unindexedInputs}, 'inputs'), data)
    let params = []
    for (let index = 0, i = 0, j = 0; index < this.inputs.length; ++index) {
      let input = this.inputs[index]
      if (input.indexed) {
        params.push(indexedParams[i++])
      } else {
        params.push(unindexedParams[j++])
      }
    }
    return params
  }
}

export const qrc20ABIs = qrc20List.map(abi => {
  if (abi.type === 'function') {
    return new MethodABI(abi)
  } else if (abi.type === 'event') {
    return new EventABI(abi)
  }
})

export const qrc721ABIs = qrc721List.map(abi => {
  if (abi.type === 'function') {
    return new MethodABI(abi)
  } else if (abi.type === 'event') {
    return new EventABI(abi)
  }
})
