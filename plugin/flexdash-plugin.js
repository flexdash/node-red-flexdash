// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) { try { // use try-catch to get stack backtrace of any error

  const WidgetAPI = require("./widget-api.js")
  let new_nodes = {} // new nodes (re-)created for this deployment, key: nr_id, value: fd_config

  // FlexDashGlobal is a singleton Node-RED plugin so nodes can call a small number of
  // functions without having a handle onto any flexdash node object.
  class FlexDashGlobal {

    // initWidget ensures that a widget for this node exists, creating it if it doesn't, and 
    // then initializing it's static params with the NR node's config
    // which is almost a clone of the config into the widget's "static" field
    // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
    // TimePlot, TreeView, etc.
    // If initWidget has to create the widget it sets config.fd_widget_id.
    // initWidget returns a handle onto the Widget API functions to manipulate
    // the widget, e.g. by setting its props.
    initWidget(node, config, widget_kind) {
      try { // ensure we can produce a stack backtrace
        RED.log.info(`Initializing ${widget_kind} widget for node ${node.id}`)
        if (!config.fd_id?.startsWith('w')) throw new Error(`bad widget ID: ${config.fd_id}`)
        let orig_fd_id = config.fd_id
        if (node._alias) {
          // this node is in a subflow, patch up the fd_id
          console.log("Widget:", node)
          RED.nodes.eachNode(n => {
            if (n.id == node._alias) {
              console.log("Alias:", n)
            }
          })
          //console.log("Z:", RED.nodes.getNode(node.z))
          config.fd_id = 'w' + node.z + '-' + node._alias
        }
        const widget_id = config.fd_id

        // check rows & cols
        config.fd_rows = parseInt(config.fd_rows, 10)
        if (!(config.fd_rows > 0 && config.fd_rows < 100)) {
          node.warn(`invalid rows: ${config.fd_rows}`)
          config.fd_rows = 1
        }
        config.fd_cols = parseInt(config.fd_cols, 10)
        if (!(config.fd_cols > 0 && config.fd_cols < 20)) {
          node.warn(`invalid cols: ${config.fd_cols}`)
          config.fd_cols = 1
        }

        // register with flow persistence...
        const container = RED.nodes.getNode(config.fd_container)
        const fd = container?.fd
        if (!fd) {
          node.warn(`Node is not part of any dashboard`)
          return null
        }
        flow_persistence.register(fd.id, widget_id, node.id)
        if (node._alias) {
          // this node is in a subflow, patch up the reference in the container
          // coming from the flow-editor, the container has a reference to the subflow template node,
          // need to remove that and add the new id
          //container.config.fd_children = container.config.fd_children.replace(","+node._alias, "")
          //container.config.fd_children += ',' + node.id
          console.log("Container:", container.config)
        }

        // delete any DisabledWidget
        // (this code runs before they are ripped out in the flows:started callback)
        if (fd.store.config.widgets[widget_id]?.kind === 'DisabledWidget') fd.store.deleteWidget(widget_id)

        // work out the props for the widget
        let props = {}
        const skip = {id:1, type:1, x:1, y:1, z:1, wires:1, _alias:1}
        for (const [k, v] of Object.entries(config)) {
          if (!k.startsWith('fd_') && !(k in skip)) props[k] = v
        }
        const fd_config = {
          id: widget_id, kind: widget_kind, rows: config.fd_rows, cols: config.fd_cols,
          static: props, dynamic: {},
          dyn_root: `node-red/${widget_id}`,
          output: `nr/${node.id}`,
        }
        fd.store.addWidget(fd_config)

        // save some info for removal
        node._fd = fd
        node._fd_id = widget_id
        return new WidgetAPI(fd, widget_id, node)

      } catch (e) {
        console.warn(`FlexDashGlobal initWidget: failed to initialize widget for node '${node.id}': ${e.stack}`)
        return null
      }
    }

    destroyWidget(node) {
      try { // ensure we can produce a stack backtrace
        const widget_id = node._fd_id
        if (!widget_id) return // initWidget must have bailed...
        const fd = node._fd
        flow_persistence.unregister(fd.id, widget_id)
        fd.store.deleteWidget(widget_id)
      } catch (e) {
        console.warn(`FlexDashGlobal destroyWidget: '${node.id}': ${e.stack}`)
      }
    }

    initDash(dash) {
      new_nodes[dash.id] = {}
    }

    destroyDash(dash) {
      // ???
    }

    initTab(tab) {
      const c = tab.config
      if (!c.fd_id?.startsWith('t')) throw new Error(`bad tab ID: ${c.fd_id}`)
      flow_persistence.register(tab.fd.id, c.fd_id, tab.id)
      // construct the tab data to put into the store
      const fd_config = { id: c.fd_id, title: c.name, icon: c.icon }
      console.log("Pushing", tab.id)
      new_nodes[tab.id] = fd_config
    }

    destroyTab(tab) {
      flow_persistence.unregister(tab.fd.id, tab.config.fd_id)
      tab.fd.store.deleteTab(tab.config.fd_id)
    }

    initGrid(grid) {
      const c = grid.config
      if (!c.fd_id?.startsWith('g')) throw new Error(`bad grid ID: ${c.fd_id}`)
      flow_persistence.register(grid.fd.id, c.fd_id, grid.id)
      // construct the grid data to put into the store
      const fd_config = {
        id: c.fd_id, kind: c.kind, title: c.name,
        min_cols: c.min_cols, max_cols: c.max_cols,
      }
      new_nodes[grid.id] = fd_config
    }

    destroyGrid(grid) {
      flow_persistence.unregister(grid.fd.id, grid.config.fd_id)
      console.log("Calling deleteGrid on " + grid.config.fd_id)
      grid.fd.store.deleteGrid(grid.config.fd_id)
    }

    initPanel(panel) {
      const c = panel.config
      if (!c.fd_id?.startsWith('w')) throw new Error(`bad panel ID: ${c.fd_id}`)
      flow_persistence.register(panel.fd.id, c.fd_id, panel.id)
      // construct panel widgets data to put into the store
      const fd_config = {
        id: c.fd_id, kind: panel.kind, title: c.name,
        rows: c.rows, cols: c.cols,
        dyn_root: "node-red/" + c.id,
        static: { solid: c.solid },
      }
      new_nodes[panel.id] = fd_config
    }

    destroyPanel(panel) {
      flow_persistence.unregister(panel.fd.id, panel.config.fd_id)
      panel.fd.store.deleteWidget(panel.config.fd_id)
    }

  }

  // Generate the FlexDash config for config nodes from the Node-RED config.
  // This happens at the time a deploy is complete because then:
  // (a) all active nodes are instantiated, so following fd_children works,
  // (b) we get the full config (incl. inactive flows) so we can access config info for
  //     disabled nodes and thereby produce proper disabled-widget info.
  // We regenerate _all_ FD config nodes because there are too many corner cases when
  // enabling/disabling flows.
  RED.events.on("flows:started", info => {
    try {
      console.log(`***** flows:started ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
      console.log("New nodes:", Object.keys(new_nodes).join(' '))

      const configs = info.config.flows
      // generate a map of all flexdash-related node configs for lookup efficiency
      const fd_configs = Object.fromEntries(configs
        .filter(c => ('fd_id' in c || c.type.startsWith('flexdash ')) &&
                     ('fd_children' in c || 'fd_container' in c))
        .map(c => [c.id, c])
      )
      //console.log(`Found ${Object.keys(fd_configs).length} flexdash-related nodes`)

      // remove all DisabledWidget widgets from the store so we don't end up with duplicates
      for (const id in fd_configs) {
        const config = fd_configs[id]
        if (config.type !== 'flexdash dashboard') continue
        const fd = RED.nodes.getNode(config.id)
        for (const w of Object.values(fd.store.config.widgets)) {
           if (w.kind === 'DisabledWidget') fd.store.deleteWidget(w.id)
        }
      }

      // generate FlexDash config for all deployed config nodes
      for (const id in fd_configs) {
        const c = fd_configs[id]
        if (!('fd_children' in c)) continue
        const node = RED.nodes.getNode(c.id)
        if (!node) continue // not deployed
        const config = node.config // we mess with the node config due to widgets in subflows...

        console.log("Generating config for " + config.type, config.id)

        // convert children Node-RED IDs to FlexDash IDs, create/flag missing children
        if (typeof config.fd_children !== 'string') {
          console.log(`Node '${node.id}' has non-string fd_children:`,
            typeof config.fd_children, config.fd_children)
          continue
        }
        const cc_nrids = config.fd_children.split(',')
        if (cc_nrids[0] == '') cc_nrids.shift() // leading comma
        const cc_fdids = cc_nrids.map(c => {
          let c_node = RED.nodes.getNode(c)
          if (c_node) return c_node.config?.fd_id || c_node._fd_id // node is active, easy...
          // look for disabled node
          if (c in fd_configs) {
            const config = fd_configs[c]
            // node is disabled, flag it as such
            if ('fd_children' in config) {
              //console.log("Found disabled config node: " + JSON.stringify(config))
              return 'x' + config.fd_id.substring(1) // flag as disabled
            } else {
              //console.log("Found disabled widget: " + JSON.stringify(config))
              const widget = {
                id: 'w' + config.id, kind: 'DisabledWidget',
                fd_cols: config.fd_cols, fd_rows: config.fd_rows,
                static: { title: config.title, nr_name: config.name }, dynamic: {},
              }
              node.fd.store.addWidget(widget)
              flow_persistence.register(node.fd.id, widget.id, c)
              return widget.id
            }
          } else {
            console.log('********** deleted node?', c)
            return 'x'
          }
        })
        //console.log("Children for " + nn.node.id + ": " + JSON.stringify(cc_fdids))

        // add config to store
        const fd_config = new_nodes[config.id]
        switch (node.type) {
          case 'flexdash dashboard':
            node.store.updateDash({tabs: cc_fdids})
            break
          case 'flexdash tab':
            if (fd_config) node.fd.store.addTab({...fd_config, grids: cc_fdids})
            else           node.fd.store.updateTab(config.fd_id, {grids: cc_fdids})
            break
          case 'flexdash container':
            if (node.config.kind.endsWith("Grid")) {
              if (fd_config) node.fd.store.addGrid({...fd_config, widgets: cc_fdids})
              else           node.fd.store.updateGrid(config.fd_id, {widgets: cc_fdids})
            } else { // panel
              if (fd_config) node.fd.store.addWidget(fd_config)
              node.fd.store.updateWidgetProp(config.fd_id, 'static', 'widgets', cc_fdids)
            }
            break
        }
      }
      new_nodes = {}

      // stop queuing mutations in all stores
      for (const id in fd_configs) {
        const config = fd_configs[id]
        if (config.type !== 'flexdash dashboard') continue
        const fd = RED.nodes.getNode(config.id)
        fd.store.stopQueueing()
      }

    } catch (e) { console.error(e.stack)  } // do not rethrow 'cause NR will die
  })

  RED.events.on("flows:stopping", info => {
    RED.log.info(`flows:stopping ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
    for (const config of info.config.flows) {
      if (config.type !== 'flexdash dashboard') continue
      const fd = RED.nodes.getNode(config.id)
      if (fd) console.log("Queueing mutations for " + config.id)
      if (fd) fd.store.do_queue = true
    }
  })


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

    convert_ids(fd_nrid, fdids) {
      return fdids.map(fdid => {
          const nr_id = this.id_map[`${fd_nrid}/${fdid}`]
          if (!nr_id) throw new Error(`there is no node for ${fd_nrid}/${fdid}`)
          return ',' + nr_id
        }).join('')
    }
    
    // save a mutation to the flow store, i.e., send it to the flow editor for persistence
    // kind is dash/tabs/grids/widgets -- second level in path ($config/<kind>/<id>?)
    saveMutation(fd_nrid, kind, el_fdid, config) { // topic has leading $config/
      this.mutation_seq++
      config = Object.assign({}, config) // make a shallow copy
      if (kind == 'dash') {
        config.fd_children = this.convert_ids(fd_nrid, config.tabs) // convert FlexDash IDs -> Node-RED IDs
        delete config.tabs
        this.mutations[fd_nrid] = config
      } else if (['tabs', 'grids', 'widgets'].includes(kind)) {
        // get the entire element config from the store
        if (!el_fdid) throw new Error(`cannot persist all ${kind}s at once`)
        // add Node-RED ID to config data before sending to flow editor
        const nr_id = this.id_map[`${fd_nrid}/${el_fdid}`]
        if (!nr_id) throw new Error(`there is no node for ${fd_nrid}/${el_fdid}`)
        // convert FlexDash IDs -> Node-RED IDs
        if (kind == 'tabs' || kind == 'grids') {
          const f = {tabs: 'grids', grids: 'widgets'}[kind]
          config.fd_children = this.convert_ids(fd_nrid, config[f]) 
          delete config[kind]
        } else if (config.kind.endsWith("Panel")) {
          config.fd_children = this.convert_ids(fd_nrid, config.static.widgets) 
          delete config.static.widgets
        }
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

  const flexdash_global = new FlexDashGlobal()
  const flow_persistence = new FlowPersistence()

  //await new Promise((resolve) => setTimeout(resolve, 2000))
  //console.log("Loading plugin now")

  const plugin = {
    type: "dashboard", // gotta make something up...
    onadd: () => {
      RED.log.info("FlexDash plugin added")
    },
    _flowPersistence: flow_persistence,
    initWidget: flexdash_global.initWidget.bind(flexdash_global),
    destroyWidget: flexdash_global.destroyWidget.bind(flexdash_global)
  }

  // export all methods of FlexDashGlobal as plugin methods, bound to FDG object
  const fg_proto = Object.getPrototypeOf(flexdash_global)
  for (const f of Object.getOwnPropertyNames(fg_proto)) {
    if (f == 'constructor') continue
    if (typeof(fg_proto[f]) == 'function') {
      //console.log("flexdash global exports: " + f)
      plugin[f] = flexdash_global[f].bind(flexdash_global)
    }
  }

  RED.plugins.registerPlugin("flexdash", plugin)

} catch(e) { console.log(`Error in ${__filename}: ${e.stack}`) }
}
