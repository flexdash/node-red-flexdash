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
        //console.log("Grid config", config)

        // move up the chain to find the flexdash dashboard node
        if (config.kind?.endsWith('Grid')) {
          this.fd = RED.nodes.getNode(config.tab)?.fd
          if (!this.fd) return
          RED.plugins.get('flexdash').initGrid(this)
        } else {
          this.fd = RED.nodes.getNode(config.parent)?.fd
          if (!this.fd) return
          RED.plugins.get('flexdash').initPanel(this)
        }
      } catch (e) { console.error(e, e.stack); throw e }

      this.on("close", () => {
        try { // use try-catch to get stack backtrace of any error
          if (this.fd) {
            if (config.kind?.endsWith('Grid')) RED.plugins.get('flexdash').destroyGrid(this)
            else RED.plugins.get('flexdash').destroyPanel(this)
          }
        } catch (e) { console.error(e, e.stack); throw e }
      })
    }

  }

  RED.nodes.registerType("flexdash container", flexdashContainer)
}
