// FlexDash-custom node for Node-RED
// Lets the user define a custom widget.
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

// superseded by the use of es-module-shims: YAY!
// // FIXME: this should use babel!
// // localImport hacks the script source code to transform import statements of modules that are
// // alreay available locally (in the browser) into simple assignments.
// function fixImport(script) {
//   script = script.replace(
//     /^\s*import\s+(.*?)\s+from\s+["']([a-zA-Z]+)["']\s*;?\s*$/gms,
//     (match, assigns, module) => {
//       if (['vue', 'vuetify', 'Vue', 'Vuetify', 'uplot'].includes(module)) {
//         if (module.startsWith('v')) module = module[0].toUpperCase() + module.slice(1)
//         assigns = assigns.replace(/\sas\s/g, ': ')
//         //console.log(`IMPORT: ${match}\n    -> const ${assigns} = window.${module};`)
//         return `const ${assigns} = window.${module};`
//       } else {
//         return match
//       }
//     })
//   return script
// }

module.exports = function (RED) {
  // Instantiate the Node-RED node, 'this' is the node being constructed
  // and config contains the values set by the user in the flow editor.
  function flexdashCustom(config) {
    RED.nodes.createNode(this, config)
    this.plugin = RED.plugins.get("flexdash")
    //console.log("FlexDash Custom node:", config)

    // Initialize the widget and get a handle onto the FlexDash widget API.
    // The props are set to empty 'cause the custom-widget doesn't offer a way to set any :-)
    const w_config = { ...config, props: {}, url: null, styles: null, errors: null }
    delete w_config.sfc_source
    // this.log(`config: ${JSON.stringify(w_config)}`)
    const widget = RED.plugins.get("flexdash").initWidget(this, w_config, "CustomWidget")
    if (!widget) return // missing config node, thus no FlexDash to hook up to, nothing to do here

    // set a property on the widget or on all widgets of the array
    function setAll(path, value) {
      widget.set(path, value) // FIXME: this doesn't work for array widgets
    }

    // compile the SFC source code into javascript and styles
    // code duplicated in the flexdash component node
    const compile = source => {
      if (typeof source != "string" || source.length == 0) {
        setAll("errors", ["SFC source code missing/empty"])
        return
      }

      //console.log(`Compiling ${source.substring(0, 100)}...`);
      let { script, styles, hash, errors } = this.plugin._sfc_compiler(this.id, source)

      if (Array.isArray(errors) && errors.length > 0) {
        errors = errors.map(err => {
          if (err.loc?.start)
            return `line ${err.loc.start.line} col ${err.loc.start.column}: ${err.message}`
          else return `${err.message}`
        })
        this.error(`Error compiling widget:\n` + errors.join("\n"))
        setAll("url", null)
        setAll("styles", null)
        setAll("errors", errors)
      } else {
        //script = fixImport(script)
        //console.log(`===== script:\n${script}`)
        // console.log(`===== styles:\n${styles.replace(/\n/g,' ')}\n=====`)
        let url = this._fd.addWidget(this.id, script)
        setAll("url", [url, hash])
        setAll("styles", styles)
        setAll("errors", null)
      }
    }

    compile(config.sfc_source)

    // handle flow input messages
    this.on("input", msg => {
      // if message has a topic and a `_delete` property then delete array-widget topic
      if ("topic" in msg && msg._delete) {
        widget.deleteTopic(msg.topic)
        return
      }

      // update widget props
      for (const k in msg) {
        if (k == "topic") continue // skip: reserved for array stuff
        if (k == "title") {
          // title is currently always set by the widget wrapper, it's not possible to tell the
          // wrapper no to set the title, so we need to set the title prop, not props/title
          widget.set("title", msg.title, { topic: msg.topic })
        } else if (k == "_source") {
          compile(msg._source)
        } else if (!k.startsWith("_")) {
          widget.set(`props/${k}`, msg[k], { topic: msg.topic }) // prop for custom widget
        }
      }
    })

    // handle messages from the widget, we receive the potential array element topic, the payload
    // sent by the widget, and the socket ID
    if (true) {
      // config.output) {
      widget.onInput((topic, payload, socket) => {
        // propagate the payload into the flow and attach the FD socket ID
        let msg = { payload: payload, _fd_socket: socket }
        // if loopback is requested, feed the message back to ourselves, implementation-wise,
        // set the payload property of the widget to the payload of the message
        if (config.fd_loopback) {
          widget.set("payload", payload, { topic }) // do we need to make a shallow clone here?
        }
        if (topic != undefined) msg.topic = topic // array elt topic has priority
        else if (config.fd_output_topic) msg.topic = config.fd_output_topic // optional non-array topic
        this.log(`sending: ${JSON.stringify(msg)}`)
        this.send(msg)
      })
    }
  }

  RED.nodes.registerType("flexdash custom", flexdashCustom)
  RED.plugins.get("node-red-vue").createVueTemplate("flexdash custom", __filename)
}
