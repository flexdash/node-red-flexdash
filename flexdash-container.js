// FlexDash container node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function (RED) {
  // configuration node
  class flexdashContainer {
    // config: name, kind, fd_children, [grids: tab, min_cols, max_cols], [panels: parent,
    //         solid, cols, rows ]
    constructor(config) {
      //try { // use try-catch to get stack backtrace of any error
      RED.nodes.createNode(this, config)
      this.config = config
      //console.log("FD Container config", config)
      this.plugin = RED.plugins.get("flexdash")

      // move up the chain to find the flexdash dashboard node
      if (config.kind?.endsWith("Grid")) {
        this.fd = RED.nodes.getNode(config.tab)?.fd
        if (!this.fd) return
        // convert rows & cols to numbers
        config.min_cols = parseInt(config.min_cols, 10)
        config.max_cols = parseInt(config.max_cols, 10)
        // deal with pre-unicast nodes
        if (!["ignore", "disallow", "allow", "require"].includes(config.unicast))
          config.unicast = "ignore"
        // register ID mapping
        this.fd_id = "g" + this.id
        // construct grid data to put into the store
        this.storeGrid()
      } else {
        // check rows & cols
        config.rows = parseInt(config.rows, 10)
        if (!(config.rows > 0 && config.rows < 100)) {
          this.warn(`invalid rows: ${config.rows}`)
          config.rows = 1
        }
        config.cols = parseInt(config.cols, 10)
        if (!(config.cols > 0 && config.cols < 20)) {
          this.warn(`invalid cols: ${config.cols}`)
          config.cols = 1
        }
        if (config.kind == "SubflowPanel") {
          // _alias: template node, z: subflow instance
          // find the subflow this panel is a part of
          if (!config._alias) throw new Error("SubflowPanel can only be used inside a subflow")
          if (!config.z) throw new Error("SubflowPanel must be associated with a subflow")
          const sf = RED.nodes.getNode(config.z)
          if (!sf) throw new Error("SubflowPanel's subflow not found")
          //console.log("Subflow config", sf.subflowInstance)
          // figure out the flexdash grid
          const e = sf.subflowInstance.env?.find(e => e.name == "flexdash_grid")
          if (!e) throw new Error("flexdash_grid missing in subflow")
          const parent = RED.nodes.getNode("" + e.value)
          if (!parent) throw new Error("Subflow's flexdash_grid node not found: " + parent)
          if (parent.type != "flexdash container" || !parent.config.kind.endsWith("Grid"))
            throw new Error("Subflow's flexdash_grid node is not a FlexDash grid")
          this.fd = parent.fd
          if (!this.fd) return
          config.parent = parent.id
          this.plugin._register_subflow_panel(sf.subflowInstance.id, this.id)
        } else {
          // "plain" Panel"
          this.fd = RED.nodes.getNode(config.parent)?.fd
          if (!this.fd) return
        }
        this.fd_id = "w" + this.id
        // construct panel data to put into the store
        this.storePanel()
      }
      //} catch (e) { console.error(e, e.stack); throw e }

      this.on("close", () => {
        try {
          // use try-catch to get stack backtrace of any error
          if (this.fd) {
            if (config.kind?.endsWith("Grid")) this.removeGrid()
            else this.removePanel()
          }
        } catch (e) {
          console.error(e, e.stack)
          throw e
        }
      })
    }

    // return handle onto enclosing grid (or this if it's a grid)
    getGrid() {
      if (this.config.kind?.endsWith("Grid")) return this
      if (this.config.parent) {
        const p = RED.nodes.getNode(this.config.parent)
        return p?.getGrid()
      }
      return null
    }

    // construct the grid data to put into the store
    storeGrid() {
      const c = this.config
      const fd_config = {
        id: this.fd_id,
        kind: c.kind,
        title: c.title,
        min_cols: c.min_cols,
        max_cols: c.max_cols,
      }
      // add show prop for pop-up grids so it can be set dynamically
      if (c.kind == "PopupGrid") fd_config.show = false
      this.plugin._newNode(this.id, this, fd_config)
    }

    removeGrid() {
      this.fd.store.deleteGrid(this.fd_id)
      this.plugin._delNode(this.id)
    }

    // construct panel widgets data to put into the store
    storePanel() {
      const c = this.config
      RED.log.debug(`Initializing ${this.config.kind} for node ${this.id} (${this.z})`)
      const fd_config = {
        id: this.fd_id,
        kind: "Panel",
        rows: c.rows,
        cols: c.cols,
        dyn_root: "node-red/" + c.id,
        static: { title: c.title, solid: c.solid },
        dynamic: {},
      }
      this.plugin._newNode(this.id, this, fd_config)
    }

    removePanel() {
      RED.log.debug(`Destroying ${this.config.kind} for node ${this.id}`)
      this.fd.store.deleteWidget(this.fd_id)
      this.plugin._delNode(this.id)
    }
  }

  RED.nodes.registerType("flexdash container", flexdashContainer)
  RED.plugins.get("node-red-vue").createVueTemplate("flexdash container", __filename)
}
