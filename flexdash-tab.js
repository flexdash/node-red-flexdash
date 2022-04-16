// FlexDash tab node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  // configuration node
  class flexdashTab {
    // config: name, icon, fd_id, fd_pos, fd
    constructor(config) {
      try { // use try-catch to get stack backtrace of any error
        //this.log("config=" + JSON.stringify(config))
        RED.nodes.createNode(this, config)
        this.config = config

        // register as container with flexdash dashboard node
        if (!config.fd) return // nothing we can really do here
        this.fd = RED.nodes.getNode(config.fd)
        if (!this.fd) return
        RED.plugins.get('flexdash').initTab(this)
      } catch (e) { console.error(e.stack); throw e }

      this.on("close", () => {
        if (this.fd) RED.plugins.get('flexdash').destroyTab(this)
      })
    }

  }

  RED.nodes.registerType("flexdash tab", flexdashTab)
}
