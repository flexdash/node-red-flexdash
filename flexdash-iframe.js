// FlexDash iframe node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function (RED) {
  class flexdashIframe {
    // config: name, icon, fd_children, fd
    constructor(config) {
      try {
        // use try-catch to get stack backtrace of any error
        //this.log("config=" + JSON.stringify(config))
        RED.nodes.createNode(this, config)
        this.fd = RED.nodes.getNode(config.fd) // get a handle onto FlexDash
        if (!this.fd) return // nothing we can do...
        this.config = config

        // register with flexdash dashboard node
        this.plugin = RED.plugins.get("flexdash")
        this.storeIframe()
      } catch (e) {
        console.error(e.stack)
        throw e
      }

      this.on("close", () => {
        try {
          // use try-catch to get stack backtrace of any error
          this.removeIframe()
        } catch (e) {
          console.error(e.stack)
          throw e
        }
      })
    }

    // an iframe tab has: title, url, slot ('a'|'b')
    storeIframe() {
      const c = this.config
      this.fd_id = "t" + this.id
      // construct the iframe tab data to put into the store
      const fd_config = {
        id: this.fd_id,
        title: c.title,
        icon: c.icon,
        url: c.url,
        slot: c.slot || "a",
      }
      this.plugin._newNode(this.id, this, fd_config)
    }

    removeIframe() {
      if (this.fp) {
        this.fd.store.deleteTab(this.fd_id)
        this.plugin._delNode(this.id)
      }
    }
  }

  RED.nodes.registerType("flexdash iframe", flexdashIframe)
}
