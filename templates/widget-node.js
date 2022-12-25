// Node-RED node implementation for FlexDash widget ##name##

module.exports = function (RED) {

  const widgetProps = ##props##
  const widgetDefaults = Object.fromEntries(Object.values(widgetProps).map(p => [p.name, p.default]))

  // Instantiate the Node-RED node, 'this' is the node being constructed
  // and config contains the values set by the user in the flow editor.
  function ##name##(config) {
    RED.nodes.createNode(this, config)

    // Create missing node properties. This is to deal with the fact that if node properties are
    // added in an upgrade then nodes in existing flows don't have them. Besides not having the
    // expected defaults, this breaks the "widget-has-property" check when setting dynamic prop
    // values.
    for (const prop in widgetDefaults) {
      if (!config.hasOwnProperty(prop)) {
        config[prop] = widgetDefaults[prop]
        this.debug("Missing property: " + prop + " added with default: " + config[prop])
      }
    }
  
    // Initialize the widget by pushing the config to its props and get a handle
    // onto the FlexDash widget API.
    // The third arg is the kind of widget to create, if it doesn't exist
    const widget = RED.plugins.get('flexdash').initWidget(this, config, '##name##')
    if (!widget) return // missing config node, thus no FlexDash to hook up to, nothing to do here

    let onNodeRedCustom, onFlexDashCustom
    ##custom_handlers##

    // handle flow input messages, basically massage them a bit and update the FD widget
    this.on("input", msg => {
      // if message has a topic and a `_delete` property then delete array-widget topic
      if ('topic' in msg && msg._delete) {
        widget.deleteTopic(msg.topic)
        return
      }
      // prepare update of widget props
      const props = Object.assign({}, msg) // shallow clone
      const options = { topic: msg.topic, socket: msg._fd_socket}
      delete props.topic
      // custom handler or built-in
      if (onNodeRedCustom) {
        onNodeRedCustom(props, options)
      } else {
        // remap msg.payload to the prop expected by the widget
        if ('##payload_prop##' && 'payload' in props) {
          props['##payload_prop##'] = props.payload
          delete props.payload
        }
      }
      if (props != {}) widget.setProps(props, options)
    })

    // handle messages from the widget, we receive the potential array element topic, the payload
    // sent by the widget, and the socket ID
    if (##output##) {
      widget.onInput((topic, payload, socket) => {
        let msg
        if (onFlexDashCustom) {
          msg = onFlexDashCustom(topic, payload, socket)
        } else {
          // propagate the payload into the flow and attach the FD socket ID
          msg = { payload: payload, _fd_socket: socket }
          // if loopback is requested, feed the message back to ourselves, implementation-wise,
          // set the payload property of the widget to the payload of the message
          if (config.fd_loopback) {
            // remap msg.payload to the prop expected by the widget
            const pl = '##payload_prop##' || 'payload'
            console.log(`loopback: ${pl} <= ${payload}`)
            // WARNING: loopback is broadcast, this could have "interesting" effects
            widget.set(pl, payload, {topic}) // do we need to make a shallow clone here?
          }
        }
        if (topic != undefined) msg.topic = topic // array elt topic has priority
        else if (config.fd_output_topic) msg.topic = config.fd_output_topic // optional non-array topic
        this.send(msg)
      })
    }
  }

  RED.nodes.registerType("##type_kebab##", ##name##)
}
