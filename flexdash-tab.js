// FlexDash tab node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  // configuration node
  class flexdashTab {
    // config: name, icon, fd_children, fd
    constructor(config) {
      try { // use try-catch to get stack backtrace of any error
        //this.log("config=" + JSON.stringify(config))
        RED.nodes.createNode(this, config)
        this.config = config
        this.plugin = RED.plugins.get('flexdash')
        this.fp = this.plugin._flowPersistence

        // register as container with flexdash dashboard node
        if (!config.fd) return // nothing we can really do here
        this.fd = RED.nodes.getNode(config.fd)
        if (!this.fd) return
        this.storeTab()
      } catch (e) { console.error(e.stack); throw e }

      this.on("close", () => {
        if (this.fd) this.removeTab()
      })
    }

    storeTab() {
      const c = this.config
      this.fd_id = 't' + this.id
      this.fp.register(this.fd.id, this.fd_id, this.id)
      // construct the tab data to put into the store
      const fd_config = { id: this.fd_id, title: c.name, icon: c.icon }
      console.log("Pushing", this.id)
      this.plugin._newNode(this.id, fd_config)
    }
  
    removeTab() {
      this.fp.unregister(this.fd.id, this.fd_id)
      this.fd.store.deleteTab(this.fd_id)
    }
  
  }

  RED.nodes.registerType("flexdash tab", flexdashTab)
}
