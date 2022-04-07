// FlexDash container node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  // configuration node
  class flexdashContainer {
    // config: name, kind, fd_pos, fd_id, [grids: tab, min_cols, max_cols], [panels: parent,
    //         solid, cols, rows ]
    constructor(config) {
      try { // use try-catch to get stack backtrace of any error
        // this.log("config=" + JSON.stringify(config))
        RED.nodes.createNode(this, config)
        this.config = config

        // move up the chain to find the flexdash dashboard node
        if (config.kind == 'grid') {
          this.fd = RED.nodes.getNode(config.tab)?.fd
          if (!this.fd) return
          this.fd.initGrid(this)
        } else {
          this.fd = RED.nodes.getNode(config.parent)?.fd
          if (!this.fd) return
          this.fd.initPanel(this)
        }
      } catch (e) { console.error(e.stack); throw e }

      this.on("close", () => {
        if (this.fd) {
          if (config.kind == 'grid') this.fd.destroyGrid(this)
          else this.fd.destroyPanel(this)
        }
      })
    }

  }

  RED.nodes.registerType("flexdash container", flexdashContainer)
}
