// FlexDash-component node for Node-RED
// Lets the user define a custom Vue component to load into FlexDash.
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

module.exports = function (RED) {
  // config: name, sfc_name, sfc_source
  function flexdashComponent(config) {
    RED.nodes.createNode(this, config)
    this.plugin = RED.plugins.get("flexdash")
    //console.log("FlexDash Custom node:", config)

    if (!config.sfc_name || !/^[a-z0-9][-a-z0-9]*/.test(config.sfc_name)) {
      this.error("Invalid component name, must be kebab-case (lower-case with dashes)")
      return
    }

    // locate the dashboard node
    const fd = RED.nodes.getNode(config.fd)
    if (!fd) {
      this.error("Custom component must be associated with a FlexDash dashboard to function")
      return // nothing we can really do here
    }

    // compile the SFC source code into javascript and styles
    // code duplicated in the flexdash custom node
    const compile = source => {
      if (typeof source != "string" || source.length == 0) {
        setAll("errors", ["Component source code missing/empty"])
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
        this.error(`Error compiling component:\n` + errors.join("\n"))
        setAll("url", null)
        setAll("styles", null)
        setAll("errors", errors)
      } else {
        //script = fixImport(script)
        //console.log(`===== script:\n${script}`)
        // console.log(`===== styles:\n${styles.replace(/\n/g,' ')}\n=====`)
        let url = this.fd.addWidget(this.id, script) // handles components as well
        setAll("url", [url, hash])
        setAll("styles", styles)
        setAll("errors", null)
      }
    }

    compile(config.sfc_source)

    // At this point the component is registered with the dashboard node so it can get shipped to
    // FlexDash. There it gets used on-demand when a widget references it.

    // TODO: the component still needs to go into the FlexDash config so FD knows that it needs
    // to load it and register it!
  }

  RED.nodes.registerType("flexdash component", flexdashComponent)
  RED.plugins.get("node-red-vue").createVueTemplate("flexdash component", __filename)
}
