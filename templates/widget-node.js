// Node-RED node implementation for FlexDash widget ##name##

module.exports = function (RED) {

  // Instantiate the Node-RED node, 'this' is the node being constructed
  // and config contains the values set by the user in the flow editor.
  function ##name##(config) {
    const fd = RED.nodes.getNode(config.fd) // get a handle onto FlexDash
    RED.nodes.createNode(this, config)
    if (!fd) return // not much we can do, will have to wait for a FD node to be selected
    
    // Initialize the widget by pushing the config to its props and get a handle
    // onto the FlexDash widget API.
    // The third arg is the kind of widget to create, if it doesn't exist
    const widget = fd.initWidget(this, config, '##name##')

    // handle flow input messages, basically massage them a bit and update the FD widget
    this.on("input", msg => {
      // prepare update of widget props (Node-RED params --> widget props)
      const props = typeof msg.params === 'object' ? Object.assign({}, msg.params) : {}
      // msg.payload is interpreted as setting the ##payload_prop## prop
      if ('payload' in msg) props.##payload_prop## = msg.payload
      widget.setProps(props)
    })

    // handle widget input messages, we receive the payload sent by the widget
    if (##output##) {
      widget.onInput(payload => {
        // propagate the payload into the flow and attach the node's ID
        this.send({payload, _flexdash_node: this.id})
      })
    }
  }

  RED.nodes.registerType("##name_kebab##", ##name##)
}
