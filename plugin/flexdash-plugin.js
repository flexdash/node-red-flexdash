// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

// The plugin exported here provides a small number of globals that nodes can call without having a
// handle onto any flexdash object.
module.exports = function(RED) { try { // use try-catch to get stack backtrace of any error

  const WidgetAPI = require("./widget-api.js")
  let new_nodes = {} // new nodes (re-)created for this deployment, key: nr_id, value: {node, config}
  let dynamics = {} // widget.dynamic setting when node is removed to avoid switch to static

  // For widget-array nodes we need to keep track of topics. This is stored here so it survives
  // redeployment, similar to 'dynamics' above.
  // array_topics is indexed by widget node ID and contains a sorted array of topics, widgets are
  // displayed in the order of the array.
  const array_topics = {}

  // We want to iterate through all FlexDash container nodes (dash/tab/grid/panel) once flows are running
  // so we can finalize the dashboard configuration. However, Node-RED has no function to iterate
  // through all deployed nodes, so we have to do it in two parts. We iterate through all node
  // configs
  let fd_containers = {} // key: nr_id, value: node}

  let all_node_configs = {} // key: nr_id, value: config; used to create DisabledWidgets

  // logging controlled by a flag in the dashboard config nodes
  // the flag is global, but shows up in every dashboard config node, should really show up in
  // a side-panel for FlexDash...
  // let verbose_logging = false
  // function log(...args) {
  //   if (verbose_logging) {
  //     RED.log.info(...args)
  //   }
  // }


  // initWidget ensures that a widget for this node exists, creating it if it doesn't, and 
  // then initializing it's static params with the NR node's config
  // which is almost a clone of the config into the widget's "static" field
  // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
  // TimePlot, TreeView, etc.
  // If initWidget has to create the widget it sets config.fd_widget_id.
  // initWidget returns a handle onto the Widget API functions to manipulate
  // the widget, e.g. by setting its props.
  function initWidget(node, config, widget_kind) {
    try { // ensure we can produce a stack backtrace
      RED.log.debug(`Initializing ${widget_kind} widget for node ${node.id} with ${JSON.stringify(config)}`)
      
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
      
      // get container and flexdash
      const container = RED.nodes.getNode(config.fd_container)
      const fd = container?.fd
      if (!fd) {
        node.warn(`Node is not part of any dashboard`)
        return null
      }
      if (node._alias) {
        if (container.config.kind != "SubflowPanel") {
          node.warn(`Node must be in a SubflowPanel because it is in a subflow`)
          return null
        }
      }
      node._fd = fd
      node._fd_container = container

      // determine FlexDash ID, may be altered below for subflow widgets
      let widget_id = 'w' + config.id
      
      // widget array
      if (config.fd_array) {
        //RED.log.debug(`Widget ${widget_id} is an array up to ${config.fd_array_max}`)
        node._fd_array_max = config.fd_array_max
        node._fd_config = config
        node._fd_kind = widget_kind
        node._fd_id = widget_id // is this needed? it's not really correct given addition of topic...
        
        // create widgets for existing topics
        if (!(node.id in array_topics)) array_topics[node.id] = []
        for (const topic of array_topics[node.id]) {
          const w_id = 'w' + config.id + '-' + topic
          addWidget(widget_kind, config, fd, w_id, w_id)
        }
        
      // non-array widget
      } else {
        if (node._alias) {
          // widget in subflow
          //RED.log.debug(`Widget ${node.id} in subflow ${node.z} of template node ${node._alias}`)
          widget_id = 'w' + node.z + '-' + node._alias
        }
        node._fd_id = widget_id
        // delete any DisabledWidget that this node may collide with due to be re-enabled
        // (this code runs before the general ripping out in the flows:started callback)
        if (fd.store.config.widgets[widget_id]?.kind === 'DisabledWidget') fd.store.deleteWidget(widget_id)
        
        // register with flow persistence so config changes coming back get saved...
        flow_persistence.register(fd.id, widget_id, node.id)

        // create widget and register for destruction when node gets destroyed
        addWidget(widget_kind, config, fd, widget_id, config.id)
      }
      
      node.on("close", () => destroyWidget(node))
      return new WidgetAPI(node, plugin)
    } catch (e) {
      RED.log.warn(`FlexDashGlobal initWidget: failed to initialize widget for node '${node.id}': ${e.stack}`)
      return null
    }
  }

  function destroyWidget(node) {
    try { // ensure we can produce a stack backtrace
      const widget_id = node._fd_id
      if (!widget_id) return // initWidget must have bailed...
      const fd = node._fd
      const widgets = node._fd_array_max ? array_topics[node.id].map(t=>widget_id+'-'+t) : [widget_id]
      for (const w_id of widgets) {
        flow_persistence.unregister(fd.id, w_id)
        // save away the "dynamic" settings for this widget (selects static/dynamic value per prop)
        const w = fd.store.config.widgets[w_id]
        if (w?.dynamic) dynamics[w_id] = w.dynamic
        fd.store.deleteWidget(w_id)
      }
    } catch (e) {
      RED.log.warn(`FlexDashGlobal destroyWidget: '${node.id}': ${e.stack}`)
    }
  }

  // Generate the FlexDash config for config nodes (dash/tab/grid/panel) from the Node-RED config.
  // This happens at the time a deploy is complete because then:
  // (a) all active nodes are instantiated, so following fd_children works,
  // (b) we get the full config (incl. inactive flows) so we can access config info for
  //     disabled nodes and thereby produce proper disabled-widget info.
  // We regenerate _all_ FD config nodes because there are too many corner cases when
  // enabling/disabling flows.
  RED.events.on("flows:started", info => {
    try {
      RED.log.debug(`\n***** flows:started ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
      RED.log.debug("New nodes:", Object.keys(new_nodes).join(' '))

      // Find all FlexDash node configs so we can create DisabledWidget widgets when we encounter them
      all_node_configs = Object.fromEntries(info.config.flows
        .filter(c => ('fd_children' in c && c.type.startsWith('flexdash ')) ||
                     ('fd_container' in c && 'fd_rows' in c))
        .map(c => [c.id, c])
      )

      // debug printing
      if (true) {
        //console.log(configs.filter(c => c.type.startsWith('subflow:')))
        for (const id in fd_containers) {
          const c = fd_containers[id].config
          let info = `${c.id} ${c.kind ? c.kind : c.type.replace(/flexdash /, '')}`
          info += ` "${c.name||c.title}"`
          if (c.z) info += ` z=${c.z}`
          for (const k of ['parent', 'tab', 'fd', 'fd_container']) if (c[k]) info += ` ${k}=${c[k]}`
          if (c.fd_children) info += `\n    children: ${c.fd_children.substring(1)}`
          //info += ' ' + Object.keys(c).join(',')
          RED.log.debug(info)
        }
      }

      // remove all DisabledWidget widgets from the store so we don't end up with duplicates
      for (const fd of Object.values(fd_containers).filter(c => c.type == 'flexdash dashboard')) {
        for (const w of Object.values(fd.store.config.widgets)) {
           if (w.kind === 'DisabledWidget') fd.store.deleteWidget(w.id)
        }
      }

      // generate FlexDash config for all deployed config nodes
      for (const id in fd_containers) {
        const node = fd_containers[id]
        const config = node.config
        if (!('fd_children' in config)) RED.log.warn("Error: no fd_children in", config)

        //RED.log.debug("Generating config for " + config.type, config.id, `kind=${config.kind}`)

        // convert children Node-RED IDs to FlexDash IDs, create/flag missing children
        if (typeof config.fd_children !== 'string') {
          RED.log.warn(`Node '${node.id}' has non-string fd_children: ${typeof config.fd_children} ${config.fd_children}`)
          continue
        }
        const cc_nrids = parse_fd_children(config.fd_children)
        let child_fdids
        if (node.type == 'flexdash dashboard' || node.type == 'flexdash tab') {
          child_fdids = genConfigChildren(cc_nrids, node.fd)
        } else { // panel or grid
          child_fdids = genGridChildren(node.config, cc_nrids, node.fd)
        }

        // add config to store
        const fd_config = new_nodes[config.id]
        switch (node.type) {
          case 'flexdash dashboard':
            node.store.updateDash({ tabs: child_fdids })
            break
          case 'flexdash tab':
            if (fd_config) node.fd.store.addTab({ ...fd_config, grids: child_fdids })
            else node.fd.store.updateTab(node.fd_id, { grids: child_fdids })
            break
          case 'flexdash iframe':
            if (fd_config) node.fd.store.addTab({ ...fd_config })
            else node.fd.store.updateTab(node.fd_id, {})
            break
          case 'flexdash container':
            if (node.config.kind.endsWith("Grid")) {
              if (fd_config) node.fd.store.addGrid({ ...fd_config, widgets: child_fdids })
              else node.fd.store.updateGrid(node.fd_id, { widgets: child_fdids })
            } else { // panel
              if (fd_config) node.fd.store.addWidget(fd_config)
              node.fd.store.updateWidgetProp(node.fd_id, 'static', 'widgets', child_fdids)
            }
            break
        }
      }
      
      // stop queuing mutations in all stores
      for (const fd of Object.values(fd_containers).filter(c => c.type == 'flexdash dashboard')) {
        fd.store.stopQueueing()
      }
      
    } catch (e) {
      console.error(e.stack) // do not rethrow 'cause NR will die
    } finally {
      new_nodes = {}
      dynamics = {}
      all_node_configs = {}
    }

  })

  RED.events.on("flows:stopping", info => {
    //RED.log.info(`flows:stopping ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
    for (const fd of Object.values(fd_containers).filter(c => c.type == 'flexdash dashboard')) {
      if (fd) RED.log.info("Queueing mutations for " + fd.id)
      if (fd) fd.store.do_queue = true
    }
  })

  // parse a container's fd_children: a comma-separated list of Node-RED IDs, with leading comma
  function parse_fd_children(fd_children) {
    const nrids = fd_children.split(',')
    if (nrids[0] == '') nrids.shift() // leading comma
    return nrids
  }

  // generate config node children, i.e., children of dash and tabs
  // for active config nodes it's a simple ID mapping
  // for config nodes in disabled flows we produce a FlexDash ID with leading 'x'
  function genConfigChildren(child_nrids) {
    return child_nrids.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) return c_node.fd_id || c_node._fd_id // node is active, easy...
      if (c_nrid in all_node_configs) {
         return 'x' + c_nrid // flag as disabled
      } else {
        RED.log.warn('Missing FD child node ${c_nrid}: assuming deleted')
        return undefined
      }
    }).filter(x=>x)
  }

  // generate grid/panel children
  // for normal active nodes it's a simple ID mapping
  // for active widget-array nodes we generate widgets for existing topics
  // for SubflowPanels we generate IDs with subflow prefix
  // for widget nodes in disabled flows we generate a placeholder DisabledWidget
  function genGridChildren(grid_config, child_nrids, fd) {
    return child_nrids.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) {
        //console.log("Grid child:", c_node.config || c_node.type)
        const c_fdid = c_node.fd_id || c_node._fd_id // panel vs. widget
        // node is non-array & active
        if (!c_node._fd_array_max) return c_fdid
        // node is widget-array, add widgets for existing topics (see flat() at end of function)
        return array_topics[c_nrid].map(t => c_fdid + '-' + t)
      }
      
      // in a subflow panel need to generate widget ID with subflow ID prefix
      if (grid_config.kind == "SubflowPanel") {
        return 'w' + grid_config.z + '-' + c_nrid
      }
      
      // in a grid, subflow panel nodes have full id in child_nrids
      if (c_nrid.length > 32 && c_nrid.includes('-')) {
        return 'w' + c_nrid // subflow panel
      }
      
      // look for disabled node
      const c_config = all_node_configs[c_nrid]
      if (c_config) {
        // node is disabled, flag it as such
        if ('fd_children' in c_config) {
          return 'x' + c_nrid // flag as disabled
        } else {
          return genDisabledWidget(c_config, fd)
        }  
      }  
      
      RED.log.warn("Missing FD grid child node ${c_nrid}, assuming deleted")
      return 'x' + c_nrid
    }).flat()
  }

  // insert a disabled widget into the store as a marker for a widget in a disabled flow
  function genDisabledWidget(config, fd) {
    const widget = {
      id: 'w' + config.id, kind: 'DisabledWidget',
      cols: config.fd_cols, rows: config.fd_rows,
      static: { title: config.title, nr_name: config.name }, dynamic: {},
    }
    fd.store.addWidget(widget)
    flow_persistence.register(fd.id, widget.id, config.id)
    return widget.id
  }

  // generate a widget from a node config
  // widget_id differs from 'w'+config.id for arrays and subflows
  function addWidget(kind, config, fd, widget_id, output_id) {
    if (!widget_id) widget_id = 'w' + config.id
    // work out the props for the widget, skip FD and Node-RED internal stuff
    let props = {}
    const skip = {id:1, type:1, x:1, y:1, z:1, wires:1, _alias:1}
    for (const [k, v] of Object.entries(config)) {
      if (!k.startsWith('fd_') && !(k in skip)) props[k] = v
    }
    const fd_config = {
      id: widget_id, kind: kind, rows: config.fd_rows, cols: config.fd_cols,
      static: props,
      dynamic: dynamics[widget_id] || {},
      dyn_root: `node-red/${widget_id}`,
      output: `nr/${widget_id.substring(1)}`, // strip leading 'w', a bit cheesy...
    }
    fd.store.addWidget(fd_config)
    flow_persistence.register(fd.id, widget_id, config.id)
    return widget_id
  }

  // add a topic to an array, which involves generating widgets for all the nodes in the array
  // this is called from the Widget API when a message with a new topic appears
  function addWidgetTopic(node, topic) {
    const topics = array_topics[node.id]
    if (topics.includes(topic)) return
    
    // new topic: need to generate widget and then sort topics
    const w_id = 'w' + node.id + '-' + topic
    addWidget(node._fd_kind, node._fd_config, node._fd, w_id, w_id)
    topics.push(topic)
    topics.sort()

    // regenerate the list of container's children (easier than trying to insert new widget)
    updateContainerChildren(node._fd_container)
  }

  function updateContainerChildren(container, fd_children=null) {
    fd_children = parse_fd_children(fd_children === null ? container.config.fd_children : fd_children)
    const c_children = fd_children.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) {
        const fd_id = c_node.fd_id || c_node._fd_id // panel vs. widget
        // node is non-array & active
        if (!c_node._fd_array_max) return fd_id
        // node is widget-array, expand topics (see flat() at end of function)
        return array_topics[c_nrid].map(t => fd_id + '-' + t)
      }
      return 'w' + c_nrid // flag as disabled widget
    }).flat()
    if (container.config.kind.endsWith('Panel')) {
      container.fd.store.updateWidgetProp(container.fd_id, 'static', 'widgets', c_children)
    } else {
      container.fd.store.updateGrid(container.fd_id, {widgets: c_children})
    }
  }

  function deleteWidgetTopic(node, topic) {
    console.log("Deleting array-widget topic " + topic + " from " + node.id)
    // remove topic from array_topics
    const ix = array_topics[node.id].indexOf(topic)
    if (ix < 0) return
    array_topics[node.id].splice(ix, 1)
    // remove widget from container children
    updateContainerChildren(node._fd_container)
    // remove widget from store
    const widget_id = node._fd_id + '-' + topic
    flow_persistence.unregister(node._fd.id, widget_id)
    node._fd.store.deleteWidget(widget_id)
    // note: we don't save the dynamic stuff 'cause it's not a destroy-deploy-recreate situation
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
      //RED.log.info(`FD register ${el_fdid}`)
      this.id_map[`${fd_nrid}/${el_fdid}`] = el_nrid
    }

    // unregister an element
    unregister(fd_nrid, el_fdid) {
      //RED.log.info(`FD unregister ${el_fdid}`)
      const nrid = this.id_map[`${fd_nrid}/${el_fdid}`]
      if (nrid) delete this.mutations[nrid]
      delete this.id_map[`${fd_nrid}/${el_fdid}`]
    }

    convert_ids(fd_nrid, fdids) {
      let nrids = ""
      let prev_nrid = null
      for (const fdid of fdids) {
        const nr_id = this.id_map[`${fd_nrid}/${fdid}`]
        if (!nr_id) throw new Error(`there is no node for ${fd_nrid}/${fdid}`)
        if (nr_id == prev_nrid) continue // repeated array-widgets
        nrids += ',' + nr_id
        prev_nrid = nr_id
      }
      console.log("*** convert_ids: " + JSON.stringify(fdids) + " -> " + nrids)
      return nrids
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
        const node = RED.nodes.getNode(nr_id)
        // convert FlexDash IDs -> Node-RED IDs
        if (kind == 'tabs') {
          config.fd_children = this.convert_ids(fd_nrid, config.grids)
          delete config.grids
        } else if (kind == 'grids') {
          config.fd_children = this.convert_ids(fd_nrid, config.widgets)
          delete config.widgets
          // FIXME: this is a hack to make the movement of array-widgets work
          if (config.fd_children != node.config.fd_children) updateContainerChildren(node, config.fd_children)
        } else if (config.kind.endsWith("Panel")) {
          config.fd_children = this.convert_ids(fd_nrid, config.static.widgets)
          delete config.static.widgets
          // FIXME: this is a hack to make the movement of array-widgets work
          if (config.fd_children != node.config.fd_children) updateContainerChildren(node, config.fd_children)
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

  const flow_persistence = new FlowPersistence()

  const plugin = {
    type: "dashboard", // gotta make something up...
    onadd: () => {
      const version = require(path.join(__dirname, '/package.json')).version
      RED.log.info(`Node-RED FlexDash plugin version ${version}`),
    },
    // public functions
    initWidget, destroyWidget,
    // private stuff
    _flowPersistence: flow_persistence,
    _addWidgetTopic: addWidgetTopic,
    _deleteWidgetTopic: deleteWidgetTopic,
    _newNode(id, node, fd_config) { new_nodes[id] = fd_config; fd_containers[id] = node },
    _delNode(id) { delete fd_containers[id] },
  }

  // export all methods of FlexDashGlobal as plugin methods, bound to FDG object
  // const fg_proto = Object.getPrototypeOf(flexdash_global)
  // for (const f of Object.getOwnPropertyNames(fg_proto)) {
  //   if (f == 'constructor') continue
  //   if (typeof(fg_proto[f]) == 'function') {
  //     //console.log("flexdash global exports: " + f)
  //     plugin[f] = flexdash_global[f].bind(flexdash_global)
  //   }
  // }

  RED.plugins.registerPlugin("flexdash", plugin)

} catch(e) { console.log(`Error in ${__filename}: ${e.stack}`) }
}
