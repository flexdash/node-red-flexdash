// Node-RED node implementation for FlexDash widget ##name##

module.exports = function (RED) {

  // Instantiate the Node-RED node, 'this' is the node being constructed
  // and config contains the values set by the user in the flow editor.
  function ##name##(config) {
    RED.nodes.createNode(this, config)
    // Initialize the widget by pushing the config to its props and get a handle
    // onto the FlexDash widget API.
    // The third arg is the kind of widget to create, if it doesn't exist
    const widget = RED.plugins.get('flexdash').initWidget(this, config, '##name##')
    if (!widget) return // missing config node, thus no FlexDash to hook up to, nothing to do here
    
    // handle flow input messages, basically massage them a bit and update the FD widget
    this.on("input", msg => {
      // prepare update of widget props
      const props = typeof msg.props === 'object' ? Object.assign({}, msg.props) : {}
      // msg.payload is interpreted as setting the ##payload_prop## prop
      if ('payload' in msg) props.##payload_prop## = msg.payload
      widget.setProps(props, msg.flexdash_index) // msg.flexdash_index is used in ArrayGrids/subflows
    })

    // handle widget input messages, we receive the payload sent by the widget
    if (##output##) {
      widget.onInput(payload => {
        // propagate the payload into the flow and attach the node's ID
        this.send({payload, _flexdash_node: this.id})
      })
    }

    // handle destruction of node: need to destroy widget too!
    this.on("close", () => { RED.plugins.get('flexdash').destroyWidget(this) })
}

  RED.nodes.registerType("##name_kebab##", ##name##)
}
