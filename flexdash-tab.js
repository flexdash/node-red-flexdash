// FlexDash tab node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function (RED) {
  // configuration node
  class flexdashTab {
    // config: name, icon, fd_children, fd
    constructor(config) {
      try {
        // use try-catch to get stack backtrace of any error
        //this.log("config=" + JSON.stringify(config))
        RED.nodes.createNode(this, config)
        this.config = config
        this.plugin = RED.plugins.get("flexdash")

        // register as container with flexdash dashboard node
        if (!config.fd) return // nothing we can really do here
        this.fd = RED.nodes.getNode(config.fd)
        if (!this.fd) return
        this.storeTab()
      } catch (e) {
        console.error(e.stack)
        throw e
      }

      this.on("close", () => {
        try {
          // use try-catch to get stack backtrace of any error
          this.removeTab()
        } catch (e) {
          console.error(e.stack)
          throw e
        }
      })
    }

    storeTab() {
      const c = this.config
      this.fd_id = "t" + this.id
      // construct the tab data to put into the store
      const fd_config = { id: this.fd_id, title: c.title, icon: c.icon }
      this.plugin._newNode(this.id, this, fd_config)
    }

    removeTab() {
      if (this.fd) {
        this.fd.store.deleteTab(this.fd_id)
        this.plugin._delNode(this.id)
      }
    }
  }

  RED.nodes.registerType("flexdash tab", flexdashTab)
  RED.plugins.get("node-red-vue").createVueTemplate("flexdash tab", __filename)
}
