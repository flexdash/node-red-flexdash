// FlexDash container node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  // configuration node
  class flexdashContainer {
    // config: name, kind, fd_children, [grids: tab, min_cols, max_cols], [panels: parent,
    //         solid, cols, rows ]
    constructor(config) {
      try { // use try-catch to get stack backtrace of any error
        // this.log("config=" + JSON.stringify(config))
        RED.nodes.createNode(this, config)
        this.config = config
        //console.log("Grid config", config)
        this.plugin = RED.plugins.get('flexdash')
        this.fp = this.plugin._flowPersistence

        // move up the chain to find the flexdash dashboard node
        if (config.kind?.endsWith('Grid')) {
          this.fd = RED.nodes.getNode(config.tab)?.fd
          if (!this.fd) return
          // convert rows & cols to numbers
          config.min_cols = parseInt(config.min_cols, 10)
          config.max_cols = parseInt(config.max_cols, 10)
          // register ID mapping
          this.fd_id = 'g' + this.id
          this.fp.register(this.fd.id, this.fd_id, this.id)
          // construct grid data to put into the store
          //if (config.kind == ArrayGrid) this.storeArrayGrid(); else
          this.storeGrid('StdGrid') // no such thing as an ArrayGrid...
        } else {
          this.fd = RED.nodes.getNode(config.parent)?.fd
          if (!this.fd) return
          // register ID mapping
          this.fd_id = 'w' + this.id
          this.fp.register(this.fd.id, this.fd_id, this.id)
          // construct panel data to put into the store
          this.storePanel()
        }
      } catch (e) { console.error(e, e.stack); throw e }

      this.on("close", () => {
        try { // use try-catch to get stack backtrace of any error
          if (this.fd) {
            if (config.kind?.endsWith('Grid')) this.removeGrid(); else this.removePanel()
          }
        } catch (e) { console.error(e, e.stack); throw e }
      })
    }

    // construct the grid data to put into the store
    storeGrid(kind) {
      const c = this.config
      const fd_config = {
        id: this.fd_id, kind: kind, title: c.name,
        min_cols: c.min_cols, max_cols: c.max_cols,
      }
      this.plugin._newNode(this.id, fd_config)
    }

    // construct the array grid data to put into the store
    // storeArrayGrid() {
    //   const c = this.config
    //   const fd_config = {
    //     id: this.fd_id, kind: 'ArrayGrid', title: c.name,
    //     min_cols: c.min_cols, max_cols: c.max_cols,
    //   }
    //   this.plugin.new_node(this.id, fd_config)
    // }

    removeGrid() {
      this.fp.unregister(this.fd.id, this.fd_id)
      this.fd.store.deleteGrid(this.fd_id)
    }

    // construct panel widgets data to put into the store
    storePanel() {
      const c = this.config
      const fd_config = {
        id: this.fd_id, kind: this.kind, title: c.name,
        rows: c.rows, cols: c.cols,
        dyn_root: "node-red/" + c.id,
        static: { solid: c.solid },
      }
      this.plugin._newNode(this.id, fd_config)
    }

    removePanel() {
      this.fp.unregister(this.fd.id, this.fd_id)
      this.fd.store.deleteWidget(this.fd_id)
    }

  }

  RED.nodes.registerType("flexdash container", flexdashContainer)
}
