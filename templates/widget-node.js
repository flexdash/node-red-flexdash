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
      // if message has a topic and a `_delete` property then delete array-widget topic
      if ('topic' in msg && msg._delete) {
        widget.deleteTopic(msg.topic)
        return
      }
      // prepare update of widget props
      const props = Object.assign({}, msg) // shallow clone
      // msg.payload is interpreted as setting the ##payload_prop## prop
      if ('payload' in msg) props.##payload_prop## = msg.payload
      // delete fields that we don't want to pass to the widget, setProps ignores ones with leading _
      for (const p of ['topic', 'payload']) delete props[p]
      widget.setProps(msg.topic, props)
    })

    // handle widget input messages, we receive the payload sent by the widget
    if (##output##) {
      widget.onInput((topic, payload) => {
        // propagate the payload into the flow and attach the node's ID
        let msg = { payload: payload, _flexdash_node: this.id }
        if (topic != undefined) msg.topic = topic
        this.send(msg)
      })
    }
  }

  RED.nodes.registerType("##name_kebab##", ##name##)
}
