// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

// The plugin exported here provides a small number of globals that nodes can call without having a
// handle onto any flexdash object.
module.exports = function(RED) { try { // use try-catch to get stack backtrace of any error

  const WidgetAPI = require("./widget-api.js")
  let new_nodes = {} // new nodes (re-)created for this deployment, key: nr_id, value: {node, config}
  let dynamics = {} // widget.dynamic setting when node is removed to avoid switch to static

  // For ArrayGrids we need to keep track of a bunch of stuff. This is atored here so it survives
  // redeployment, similar to 'dynamics' above.
  // array_mapping in indexed by ArrayGrid node ID and contains an object with topic_keys and
  // topic_sort_key as value
  const array_mapping = {}
  let fd_configs = {} // node configs for all flexdash-related nodes, used to gen disabled widgets

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
      RED.log.info(`Initializing ${widget_kind} widget for node ${node.id}`)
      // determine FlexDash ID
      let widget_id = 'w' + config.id
      if (node._alias) {
        // this node is in a subflow, construct a special fd_id
        console.log("Widget:", node)
        RED.nodes.eachNode(n => {
          if (n.id == node._alias) {
            console.log("Alias:", n)
          }
        })
        //console.log("Z:", RED.nodes.getNode(node.z))
        widget_id = 'w' + node.z + '-' + node._alias
      }
      
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
      node._fd = fd
      node._fd_container = container
      node._fd_id = widget_id
      
      if (node._alias) {
        // this node is in a subflow, patch up the reference in the container
        // coming from the flow-editor, the container has a reference to the subflow template node,
        // need to remove that and add the new id
        //container.config.fd_children = container.config.fd_children.replace(","+node._alias, "")
        //container.config.fd_children += ',' + node.id
        console.log("Container:", container.config)
        throw new Error("Widgets in subflows not supported yet")
      } else if (container.config.kind == "ArrayGrid") {
        console.log(`Widget ${widget_id} is in ArrayGrid ${container.id}`)
        node._fd_config = config
        node._fd_kind = widget_kind
        return new WidgetAPI(node, plugin)
      } else {
        // delete any DisabledWidget that this node may collide with due to be re-enabled
        // (this code runs before the general ripping out in the flows:started callback)
        if (fd.store.config.widgets[widget_id]?.kind === 'DisabledWidget') fd.store.deleteWidget(widget_id)
        
        // register with flow persistence so config changes coming back get saved...
        flow_persistence.register(fd.id, widget_id, node.id)

        addWidget(widget_kind, config, fd)
        return new WidgetAPI(node, plugin)
      }

    } catch (e) {
      console.warn(`FlexDashGlobal initWidget: failed to initialize widget for node '${node.id}': ${e.stack}`)
      return null
    }
  }

  function destroyWidget(node) {
    try { // ensure we can produce a stack backtrace
      const widget_id = node._fd_id
      if (!widget_id) return // initWidget must have bailed...
      if (node._fd_container) return // widget in an array grid, nothing to do  FIXME: save dynamics!
      const fd = node._fd
      flow_persistence.unregister(fd.id, widget_id)
      // save away the "dynamic" settings for this widget (selects static/dynamic value per prop)
      const w = fd.store.config.widgets[widget_id]
      if (w?.dynamic) dynamics[widget_id] = w.dynamic
      fd.store.deleteWidget(widget_id)
    } catch (e) {
      console.warn(`FlexDashGlobal destroyWidget: '${node.id}': ${e.stack}`)
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
      fd_configs = Object.fromEntries(configs
        .filter(c => ('fd_children' in c && c.type.startsWith('flexdash ')) ||
                     ('fd_container' in c && 'fd_rows' in c))
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
        const config = fd_configs[id]
        if (!('fd_children' in config)) continue
        const node = RED.nodes.getNode(config.id)
        if (!node) continue // not deployed

        console.log("Generating config for " + config.type, config.kind, config.id)

        // convert children Node-RED IDs to FlexDash IDs, create/flag missing children
        if (typeof config.fd_children !== 'string') {
          console.log(`Node '${node.id}' has non-string fd_children:`,
            typeof config.fd_children, config.fd_children)
          continue
        }
        const cc_nrids = config.fd_children.split(',') // "cc_" = "config children"
        if (cc_nrids[0] == '') cc_nrids.shift() // leading comma
        let child_fdids
        if (node.type == 'flexdash dashboard' || node.type == 'flexdash tab') {
          child_fdids = genConfigChildren(cc_nrids, node.fd)
        } else if (config.kind == "ArrayGrid" ) {
          // iterate through topics saved in array_mapping and create widgets for each
          child_fdids = []
          let topics = Object.keys(array_mapping) || []
          topics.sort((a,b) => array_mapping[a] - array_mapping[b])
          for (const topic of topics) {
            const c_fdids = genArrayGridChildren(cc_nrids, topic, node.fd)
            child_fdids.push(...c_fdids)
          }
          console.log(`Initial ArrayGrid ${id}: ${cc_nrids.join(' ')}\n-> ${child_fdids.join(' ')}`)
        } else {
          child_fdids = genGridChildren(cc_nrids, node.fd)
        }
        //console.log("Children for " + node.id + ": " + JSON.stringify(child_fdids))

        // add config to store
        const fd_config = new_nodes[config.id]
        switch (node.type) {
          case 'flexdash dashboard':
            node.store.updateDash({tabs: child_fdids})
            break
          case 'flexdash tab':
            if (fd_config) node.fd.store.addTab({...fd_config, grids: child_fdids})
            else           node.fd.store.updateTab(node.fd_id, {grids: child_fdids})
            break
          case 'flexdash container':
            if (node.config.kind.endsWith("Grid")) {
              if (fd_config) node.fd.store.addGrid({...fd_config, widgets: child_fdids})
              else           node.fd.store.updateGrid(node.fd_id, {widgets: child_fdids})
            } else { // panel
              if (fd_config) node.fd.store.addWidget(fd_config)
              node.fd.store.updateWidgetProp(node.fd_id, 'static', 'widgets', child_fdids)
            }
            break
        }
      }
      new_nodes = {}
      dynamics = {}

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

  // generate config node children, i.e., children of dash and tabs
  // for active config nodes it's a simple ID mapping
  // for config nodes in disabled flows we produce a FlexDash ID with leading 'x'
  function genConfigChildren(child_nrids) {
    return child_nrids.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) return c_node.fd_id || c_node._fd_id // node is active, easy...
      // look for disabled node
      if (c_nrid in fd_configs) {
         return 'x' + c_nrid // flag as disabled
      } else {
        console.log('********** deleted node?', c_nrid)
        return 'x' + c_nrid
      }
    })
  }

  // generate grid/panel children
  // for active nodes it's a simple ID mapping
  // for widget nodes in disabled flows we generate a placeholder DisabledWidget
  function genGridChildren(child_nrids, fd) {
    return child_nrids.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) return c_node.fd_id || c_node._fd_id // node is active, easy...
      // look for disabled node
      if (c_nrid in fd_configs) {
        const c_config = fd_configs[c_nrid]
        // node is disabled, flag it as such
        if ('fd_children' in c_config) {
          //console.log("Found disabled config node: " + JSON.stringify(config))
          return 'x' + c_nrid // flag as disabled
        } else {
          return genDisabledWidget(c_config, fd)
        }
      } else {
        console.log('********** deleted node?', c_nrid)
        return 'x'
      }
    })
  }

  // generate array grid children for one topic
  function genArrayGridChildren(child_nrids, topic, fd) {
    return child_nrids.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) {
        // active node, create a clone widget for the array
        const clone = Object.assign(c_node._fd_config)
        return addWidget(c_node._fd_kind, c_node._fd_config, fd, topic)
      } else if (c_nrid in fd_configs) {
        // node is disabled, flag it as such
        const c_config = fd_configs[c_nrid]
        if ('fd_children' in c_config) {
          //console.log("Found disabled config node: " + JSON.stringify(config))
          return 'x' + c_nrid // flag as disabled
        } else {
          return genDisabledWidget(c_config, fd)
        }
      } else {
        console.log('********** deleted node?', c_nrid)
        return 'x'
      }
    })
  }

  // insert a disabled widget into the store as a marker for a widget in a disabled flow
  function genDisabledWidget(config, fd) {
    //console.log("Found disabled widget: " + JSON.stringify(config))
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
  function addWidget(kind, config, fd, topic=null) {
    let widget_id = 'w' + config.id
    if (topic !== null) widget_id += '-' + topic // used for arrays
    // work out the props for the widget
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
      output: `nr/${widget_id}`,
    }
    fd.store.addWidget(fd_config)
    return widget_id
  }

  // add a topic to an array, which involves generating widgets for all the nodes in the array
  // this is called from the Widget API when a message with a new topic appears
  function addArrayTopic(grid, topic_key, topic_sort) {
    if (!(grid.id in array_mapping)) array_mapping[grid.id] = {}
    const topics = array_mapping[grid.id]
    
    // new topic: need to generate widgets and then sort grid children
    if (!(topic_key in topics)) {
      console.log(`Adding ArrayGrid topic ${topic_key}(${topic_sort}) to ${grid.id}`)
      topics[topic_key] = topic_sort
      // get list of nrids to generate children from
      const child_nrids = grid.config.fd_children.split(',')
      if (child_nrids[0] == '') child_nrids.shift() // leading comma
      const new_fdids = genArrayGridChildren(child_nrids, topic_key, grid.fd)
      // add the new widgets to the grid's children
      const fd = grid.fd
      const child_fdids = fd.store.config.grids[grid.fd_id].widgets.concat(new_fdids)
      console.log("Sorting: " + JSON.stringify(child_fdids))
      child_fdids.sort((a,b) => arraySortFun(grid, a, b))
      fd.store.updateGrid(grid.fd_id, {widgets: child_fdids})

    // existing topic but sort key has been changed: re-sort grid children
    } else if (topics[topic_key] != topic_sort) {
      console.log(`Resorting ArrayGrid topic ${topic_key}(${topic_sort}) of ${grid.id}`)
      const child_fdids = fd.store.config.grids[grid.fd_id].widgets
      child_fdids.sort((a,b) => arraySortFun(grid, a, b))
      fd.store.updateGrid(grid.fd_id, {widgets: child_fdids})
    }

    console.log("Array mapping: " + JSON.stringify(array_mapping[grid.id]))
  }

  // sort two fdids in an array based on the topic sort order and then the widget order within the topic
  // this function is rather inefficient, but we hope it's tolerable...
  function arraySortFun(grid, a, b) {
    // split parent/template widget_id and topic
    const [ aw, at ] = a.split('-')
    const [ bw, bt ] = b.split('-')
    if (at == bt) {
      return grid.config.fd_children.indexOf(aw) - grid.config.fd_children.indexOf(bw)
    } else {
      return array_mapping[grid.id][at] - array_mapping[grid.id][bt]
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

  const flow_persistence = new FlowPersistence()

  const plugin = {
    type: "dashboard", // gotta make something up...
    onadd: () => RED.log.info("FlexDash plugin added"),
    // public functions
    initWidget, destroyWidget,
    // private stuff
    _flowPersistence: flow_persistence,
    _addArrayTopic: addArrayTopic,
    _newNode(id, config) { new_nodes[id] = config },
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
