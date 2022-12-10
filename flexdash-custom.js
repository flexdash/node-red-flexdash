// FlexDash-custom node for Node-RED
// Lets the user define a custom widget.
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

// FIXME: this should use babel!
// localImport hacks the script source code to transform import statements of modules that are
// alreay available locally (in the browser) into simple assignments.
function fixImport(script) {
  script = script.replace(
    /^\s*import\s+(.*?)\s+from\s+["']([a-zA-Z]+)["']\s*;?\s*$/gms,
    (match, assigns, module) => {
      if (['vue', 'vuetify', 'Vue', 'Vuetify', 'uplot'].includes(module)) {
        if (module.startsWith('v')) module = module[0].toUpperCase() + module.slice(1)
        assigns = assigns.replace(/\sas\s/g, ': ')
        //console.log(`IMPORT: ${match}\n    -> const ${assigns} = window.${module};`)
        return `const ${assigns} = window.${module};`
      } else {
        return match
      }
    })
  return script
}

module.exports = function (RED) {

  // Instantiate the Node-RED node, 'this' is the node being constructed
  // and config contains the values set by the user in the flow editor.
  function flexdashCustom(config) {
    RED.nodes.createNode(this, config)
    const node = this
    //console.log("FlexDash Custom node:", config)

    this.plugin = RED.plugins.get('flexdash')
    let script, styles, hash, errors

    // compile the SFC source code into javascript
    function compile(source) {
      console.log(`Compiling ${source.substring(0, 100)}...`);
      ({ script, styles, hash, errors } = node.plugin._sfc_compiler(node.id, source))
      if (errors && errors.length > 0) {
        let msg = `Error compiling widget:\n`
        for (const err of errors) {
          if (err.loc?.start) {
            msg += `  ${err.loc.start.line}:${err.loc.start.column} ${err.message}\n`
          } else {
            msg += `  ${err.message}\n`
          }
        }
        node.error(msg)
        return
      }
      script = fixImport(script)
      // console.log(`===== script:\n${script}`)
      // console.log(`===== styles:\n${styles.replace(/\n/g,' ')}`)
      // console.log('=====')
    }

    // compile the SFC source code
    if (config.sfc_source && config.sfc_source.length > 2) compile(config.sfc_source)

    // Initialize the widget and get a handle onto the FlexDash widget API.
    // The props are set to empty 'cause the custom-widget doesn't offer a way to set any :-)
    const w_config = { ...config, styles, props:{}, url:null, name: null }
    delete w_config.sfc_source
    this.log(`config: ${JSON.stringify(w_config)}`)
    const widget = RED.plugins.get('flexdash').initWidget(this, w_config, "CustomWidget")
    if (!widget) return // missing config node, thus no FlexDash to hook up to, nothing to do here

    let url = this._fd.addWidget(this.id, script)
    widget.set(null, 'url', [url,hash])  // FIXME: this doesn't work for array widgets

    // handle flow input messages
    this.on("input", msg => {
      // if message has a topic and a `_delete` property then delete array-widget topic
      if ('topic' in msg && msg._delete) {
        widget.deleteTopic(msg.topic)
        return
      }

      // update widget props
      for (const k in msg) {
        if (k == 'topic') continue // skip: reserved for array stuff
        if (k == '_source') {
          // FIXME: this doesn't work for array widgets, need to update all in array
          if (typeof msg._source == 'string') {
            compile(msg._source)
            if (errors === null) {
              url = this._fd.addWidget(this.id, script)
              widget.set(null, 'url', [url,hash])  // FIXME: this doesn't work for array widgets
              widget.set(null, 'styles', styles)  // FIXME: this doesn't work for array widgets
            }
          }
        } else if (!k.startsWith('_')) {
          widget.set(msg.topic, `props/${k}`, msg[k]) // prop for custom widget
        }
      }
    })

    // handle messages from the widget, we receive the potential array element topic, the payload
    // sent by the widget, and the socket ID
    if (true) { // config.output) {
      widget.onInput((topic, payload, socket) => {
        // propagate the payload into the flow and attach the FD socket ID
        let msg = { payload: payload, _flexdash_socket: socket }
        // if loopback is requested, feed the message back to ourselves, implementation-wise,
        // set the payload property of the widget to the payload of the message
        if (config.fd_loopback) {
          console.log(`loopback: payload <= ${payload}`)
          widget.set(topic, 'payload', payload) // do we need to make a shallow clone here?
        }
        if (topic != undefined) msg.topic = topic // array elt topic has priority
        else if (config.fd_output_topic) msg.topic = config.fd_output_topic // optional non-array topic
        this.log(`sending: ${JSON.stringify(msg)}`)
        this.send(msg)
      })
    }
  }

  RED.nodes.registerType("flexdash custom", flexdashCustom)
}
