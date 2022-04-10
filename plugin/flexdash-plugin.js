// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) { try { // use try-catch to get stack backtrace of any error

  const WidgetAPI = require("./widget-api.js")

  // FlexDashGlobal is a singleton Node-RED plugin so nodes can call a small number of
  // functions without having a handle onto a dashboard object.
  class FlexDashGlobal {
    constructor() {
      this.widgets = {}
    }

    // initWidget ensures that a widget for this node exists, creating it if it doesn't, and 
    // then initializing it's static params with the NR node's config
    // which is almost a clone of the config into the widget's "static" field
    // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
    // TimePlot, TreeView, etc.
    // If initWidget has to create the widget it sets config.fd_widget_id.
    // initWidget returns a handle onto the Widget API functions to manipulate
    // the widget, e.g. by setting its props.
    initWidget(node, config, widget_kind) {
      RED.log.info(`Initializing ${widget_kind} widget for node ${node.id}`)
      try { // ensure we can produce a stack backtrace
        const widget_id = "w" + node.id
        config.fd_rows = parseInt(config.fd_rows, 10)
        config.fd_cols = parseInt(config.fd_cols, 10)
        if (!(config.fd_rows > 0 && config.fd_rows < 100)) throw new Error(`invalid rows: ${config.fd_rows}`)
        if (!(config.fd_cols > 0 && config.fd_cols < 20)) throw new Error(`invalid cols: ${config.fd_cols}`)
        // work out the props for the widget
        if (!('title' in config) && config.name) config.title = config.name
        let props = {}
        const skip = {id:1, type:1, x:1, y:1, z:1, wires:1}
        for (const [k, v] of Object.entries(config)) {
          if (!k.startsWith('fd_') && !(k in skip)) props[k] = v
        }
        const fd_config = {
          id: widget_id, kind: widget_kind,
          pos: config.fd_pos, rows: config.fd_rows, cols: config.fd_cols,
          dyn_root: "node-red/" + widget_id,
          static: props,
          output: `nr/${node.id}`,
          dynamic: {},
        }
        // find the grid or panel and add the widget to it
        const container = RED.nodes.getNode(config.fd_container)
        const fd = container?.fd
        if (!container || !fd) {
          console.log(`FlexDashGlobal initWidget: widget node ${node.id} is not in any dashboard`)
          return null
        }
        const c_id = container.config.fd_id
        this.widgets[node.id] = { fd: fd.id, w_id: widget_id, c_id: c_id, c_kind: container.config.kind }
        if (container.config.kind === 'panel') {
          fd.store.addPanelWidget(c_id, fd_config)
        } else {
          fd.store.addWidget(c_id, fd_config)
        }
        // register with flow persistence...
        flow_persistence.register(fd.id, widget_id, node.id)
        return new WidgetAPI(fd, widget_id, node)
      } catch (e) {
        console.warn(`FlexDashGlobal initWidget: failed to initialize widget for node '${node.id}': ${e.stack}`)
        return null
      }
    }

    // ***** FIXME: this.widgets.fd is a problem when the dashboard gets re-deployed!

    destroyWidget(node) {
      const info = this.widgets[node.id]
      if (!info || !info.c_id || !info.fd) {
        console.log(`FlexDashGlobal destroyWidget: widget node ${node.id} was not deployed`)
        return
      }
      const fd = RED.nodes.getNode(info.fd)
      if (!fd) {
        console.log(`FlexDashGlobal destroyWidget: dashboard node ${info.fd} was not found`)
        return
      }
      flow_persistence.unregister(fd.id, info.w_id)
      if (info.c_kind === 'panel') {
        fd.store.deletePanelWidget(info.w_id, info.c_id)
      } else {
        fd.store.deleteWidget(info.w_id, info.c_id)
      }
      delete this.widgets[node.id]
    }
  }

  // Communication with the flow editor goes via a global singleton, defined here.
  //
  // The main task is to push configuration changes to the flow editor so they can be represented
  // there in the appropriate nodes and then deployed, i.e. persisted by the user.
  // The way it works is as follows:
  // - all changes trigger a sequence number increase, the purpose of which is to allow the flow
  //   editor to notice when there's something new
  // - the sequence number is "published" to the flow editor with a "retain" flag, this way a newly
  //   connecting flow editor will immediately notice that there are pending changes
  // - when there's a new pending change the flow editor performs an ajax call to get the full set
  //   of changes (this could be optimized in the future)
  // - whatever happens then is in the hands of the flow editor until the user hits deploy, at that
  //   point changed nodes are destroyed and recreated in the runtime; during the destruction
  //   we drop pending changes for a node
  // - there currently is a race condition where a change could come in from a dashboard while a
  //   node is being re-created, or it could come in right as the user hits 'deploy', how to deal
  //   with this is a bit TBD... (Maybe the answer is "don't do this"...)

  class FlowPersistence {
    constructor() {
      this.mutations = {} // mutations to be saved, indexed by element node ID
      this.mutation_seq = Date.now() // sequence number for mutations
      this.saveTimer = null
      this.id_map = {} // map to node-red ID, indexed as FD node ID / element FD ID

      // express handler to get the list of pending mutations
      RED.httpAdmin.get("/_flexdash/mutations", (req, res) => {
        res.set('Content-Type', 'application/json')
        res.send(JSON.stringify(this.mutations))
      })

    }

    // register an element (tab, grid, widget) mapping: flexdash-dashboard node-red ID, element
    // flexdash ID get mapped to element node-red ID
    register(fd_nrid, el_fdid, el_nrid) {
      RED.log.info(`FD register ${el_fdid}`)
      this.id_map[`${fd_nrid}/${el_fdid}`] = el_nrid
    }

    // unregister an element
    unregister(fd_nrid, el_fdid) {
      RED.log.info(`FD unregister ${el_fdid}`)
      const nrid = this.id_map[`${fd_nrid}/${el_fdid}`]
      if (nrid) delete this.mutations[nrid]
      delete this.id_map[`${fd_nrid}/${el_fdid}`]
    }
    
    // save a mutation to the flow store, i.e., send it to the flow editor for persistence
    saveMutation(fd_nrid, kind, el_fdid, config) { // topic has leading $config/
      this.mutation_seq++
      config = Object.assign({}, config) // make a copy
      if (kind == 'dash') {
        // get the entire dash config from the store
        this.mutations[fd_nrid] = config
      } else if (['tabs', 'grids', 'widgets'].includes(kind)) {
        // get the entire element config from the store
        if (!el_fdid) throw new Error(`cannot persist all ${kind}s at once`)
        // add Node-RED ID to config data before sending to flow editor
        const nr_id = this.id_map[`${fd_nrid}/${el_fdid}`]
        if (!nr_id) throw new Error(`there is no node for ${fd_nrid}/${el_fdid}`)
        this.mutations[nr_id] = config
      } else {
        throw new Error("Cannot persist " + topic)
      }
      this.saveNotify(this.mutation_seq)
    }
    
    // set persistent notification so the flow editor knows to pull the latest mutations
    saveNotify(seq) {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        RED.comms.publish('flexdash-mutation', { seq }, 'retain')
      }, 300)
    }
  }


  // ===== Exports

  var flexdash_global = new FlexDashGlobal()
  var flow_persistence = new FlowPersistence()

  //await new Promise((resolve) => setTimeout(resolve, 2000))
  //console.log("Loading plugin now")

  RED.plugins.registerPlugin("flexdash", {
    type: "dashboard", // gotta make something up...
    onadd: () => {
      RED.log.info("FlexDash plugin added")
    },
    _flowPersistence: flow_persistence,
    initWidget: flexdash_global.initWidget.bind(flexdash_global),
    destroyWidget: flexdash_global.destroyWidget.bind(flexdash_global)
  })

} catch(e) { console.log(`Error in ${__filename}: ${e.stack}`) }
}
