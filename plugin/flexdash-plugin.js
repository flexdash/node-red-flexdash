// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

let path = require('path')

// The plugin exported here provides a small number of globals that nodes can call without having a
// handle onto any flexdash object.
module.exports = function(RED) { try { // use try-catch to get stack backtrace of any error

  const WidgetAPI = require("./widget-api.js")

  let new_nodes = {} // new nodes (re-)created for this deployment, key: nr_id, value: {node, config}

  // during a 'deploy', dynamics records the widget.dynamic settings of nodes that are removed so
  // the values can be put back if the nodes are re-instantiated due to having been changed.
  // This avoid loosing the info and causing jarring changes in the dashboard.
  let dynamics = {} // indexed by flexdash widget id

  // For widget-array nodes we need to keep track of topics. This is stored here so it survives
  // redeployment, similar to 'dynamics' above.
  // array_topics is indexed by widget node ID and contains a sorted array of topics, widgets are
  // displayed in the order of the array.
  const array_topics = {}

  // We want to iterate through all FlexDash container nodes (dash/tab/grid/panel) once flows are running
  // so we can finalize the dashboard configuration. However, Node-RED has no function to iterate
  // through all deployed nodes, so we have to maintain the list manually by calling _newNode in
  // all containers' .js files.
  let fd_containers = {} // key: nr_id, value: node}

  // When processing an fd_children array We need to distinguish disabled nodes from deleted nodes.
  // (We also want to put placeholders for disabled nodes into the dashboard.)
  // For these purposes we build a list of all FD config nodes so we can do a quick look-up,
  // since Node-RED doesn't provide such functionality.
  let all_node_configs = {} // key: nr_id, value: config; used to create DisabledWidgets

  // For each widget "template" node in some subflow provide a map of subflow instance ID to the
  // corresponding instantiated node.
  let subflow_widgets = {} // key: nr_id of config/template node, value: { sfi_id: node_id }

  // For each subflow instance node that has a panel link to the panel node
  let subflow_panels = {} // key: nr_id of subflow instance, value: panel node ID

  // generate a FlexDash ID from a "plain" FD ID for an array widget
  function genArrayFDId(fd_id, topic) {
    return fd_id + "|" + topic.toString()
  }

  // initWidget creates a widget for this node, and then initializing its static params with the
  // NR node's config which is almost a clone of the config into the widget's "static" field.
  // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
  // TimePlot, TreeView, etc.
  // initWidget returns a handle onto the Widget API functions to manipulate the widget.
  function initWidget(node, config, widget_kind) {
    try { // ensure we can produce a stack backtrace
      RED.log.debug(`Initializing ${widget_kind} widget for node ${node.id}`) //  with ${JSON.stringify(config)}`)
      
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
        // _alias: the node's template, z: the subflow instance ID, container: panel instance
        if (container.config.kind != "SubflowPanel") {
          node.warn(`Node must be in a SubflowPanel because it is in a subflow`)
          return null
        }
        // register that this node is an instantiation in a subflow
        const tmpl_id = node._alias
        if (!subflow_widgets[tmpl_id]) subflow_widgets[tmpl_id] = {}
        subflow_widgets[tmpl_id][node.z] = node.id
      }
      node._fd = fd
      node._fd_container = container
      node._fd_id = 'w' + node.id
      
      // widget array
      if (config.fd_array) {
        //RED.log.debug(`Widget ${widget_id} is an array up to ${config.fd_array_max}`)
        node._fd_array_max = config.fd_array_max
        node._fd_config = config
        node._fd_kind = widget_kind
        
        // create widgets for existing topics
        if (!(node.id in array_topics)) array_topics[node.id] = []
        for (const topic of array_topics[node.id]) {
          const fd_id = genArrayFDId(node._fd_id, topic)
          addWidget(widget_kind, config, fd, fd_id, config.id)
        }
        
      // non-array widget
      } else {
        node._fd_kind = widget_kind
        addWidget(widget_kind, config, fd, node._fd_id)
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
      RED.log.debug(`Destroying ${node._fd_kind} widget for node ${node.id}`)
      const widget_id = node._fd_id
      if (!widget_id) return // initWidget must have bailed...
      const fd = node._fd
      const widgets = node.id in array_topics ?
          array_topics[node.id].map(t=>genArrayFDId(widget_id, t)) : [widget_id]
      // we don't clear array_topics[node.id] here because the node may be immediately re-created if
      // it's just being re-deployed with changes
      for (const w_id of widgets) {
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
      // RED.log.debug("New nodes: " + Object.keys(new_nodes).join(' '))

      // Find all FlexDash node configs so we can create DisabledWidget widgets when we encounter them
      all_node_configs = Object.fromEntries(info.config.flows
        .filter(c => ('fd_children' in c && c.type.startsWith('flexdash ')) ||
                     ('fd_container' in c && 'fd_rows' in c))
        .map(c => [c.id, c])
      )

      // Remove deleted nodes from subflow_widgets and subflow_panels
      const new_sp = {}
      for (const id in subflow_panels) if (RED.nodes.getNode(id)) new_sp[id] = subflow_panels[id]
      subflow_panels = new_sp
      const new_sw = {}
      for (const id in subflow_widgets) if (id in all_node_configs) new_sw[id] = subflow_widgets[id]
      subflow_widgets = new_sw

      // console.log(`subflow_widgets: ${JSON.stringify(subflow_widgets)}`)
      // console.log(`subflow_panels: ${JSON.stringify(subflow_panels)}`)

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
          child_fdids = genDashTabChildren(cc_nrids)
        } else if (node.config.kind == "SubflowPanel") {
          child_fdids = genGridChildren(cc_nrids, node.z)
        } else { // panel or grid
          child_fdids = genGridChildren(cc_nrids, null)
        }
        
        // debug printing
        if (true) {
          const c = fd_containers[id].config
          let info = `FD ${c.id} ${c.kind ? c.kind : c.type.replace(/flexdash /, '')}`
          info += ` "${c.name||c.title||''}"`
          if (c.z) info += ` z=${c.z}`
          for (const k of ['parent', 'tab', 'fd', 'fd_container']) if (c[k]) info += ` ${k}=${c[k]}`
          //if (child_fdids.length > 0) info += `\n   ${child_fdids.join(' ')}`
          for (const ch_id of cc_nrids) {
            let ch = all_node_configs[ch_id]
            if (ch) {
              info += `\n   ${ch_id}   ${ch?.type} "${ch?.name||ch?.title}"`
              if (!ch.type) console.log("ch_id has" , Object.keys(ch).join(','))
            } else if (subflow_panels[ch_id]) {
              ch = RED.nodes.getNode(subflow_panels[ch_id])
              info += `\n   ${ch_id}   subflow panel "${ch?.name||ch?.title}"`
            } else {
              info += `\n   ${ch_id}   missing node config`
            }
          }
          //info += ' ' + Object.keys(c).join(',')
          console.log(info)
        }
  
        // add config to store
        const fd_config = new_nodes[config.id]
        switch (node.type) {
          case 'flexdash dashboard':
            node.fd.store.updateDash({ tabs: child_fdids })
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
      //all_node_configs = {} // keep for debug check in saveMutation
    }

  })

  RED.events.on("flows:stopping", info => {
    //RED.log.info(`flows:stopping ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
    for (const fd of Object.values(fd_containers).filter(c => c.type == 'flexdash dashboard')) {
      //if (fd) RED.log.info("Queueing mutations for " + fd.id)
      if (fd) fd.store.do_queue = true
    }
  })

  // parse a container's fd_children: a comma-separated list of Node-RED IDs, with leading comma
  function parse_fd_children(fd_children) {
    const nrids = fd_children.split(',')
    if (nrids[0] == '') nrids.shift() // leading comma
    // deduplicate (being defensive)
    const c = {}, ret = []
    for (const nrid of nrids) {
      if (nrid in c) continue
      c[nrid] = true
      ret.push(nrid)
    }
    return ret
  }

  // generate config node children, i.e., children of dash and tabs
  // returns an array of FlexDash IDs
  function genDashTabChildren(child_nrids) {
    return child_nrids.map(c_nrid => {
      let c_node = RED.nodes.getNode(c_nrid)
      if (c_node) return c_node.fd_id || c_node._fd_id // node is active, easy...
      if (all_node_configs[c_nrid]) return 'x' + c_nrid // disabled
      return undefined // deleted
    }).filter(x=>x)
  }

  // generate grid/panel children
  // returns an array of FlexDash IDs
  function genGridChildren(child_nrids, flow_nrid) {
    return child_nrids.map(c_nrid => {
      // handle subflow nodes
      const c_nrid_orig = c_nrid
      if (subflow_widgets[c_nrid]) c_nrid = subflow_widgets[c_nrid][flow_nrid]
      else if (subflow_panels[c_nrid]) c_nrid = subflow_panels[c_nrid]
      if (!c_nrid) throw new Error(`Failure converting subflow widget ${c_nrid_orig} for flow ${flow_nrid}`)
      //if (!c_nrid) console.log("Failure converting subflow widget nrid for flow " + flow_nrid)
      let c_node = RED.nodes.getNode(c_nrid)
      if (!c_node) {
        // handle disabled & deleted nodes
        const c_config = all_node_configs[c_nrid]
        if (c_config) return 'x' + c_nrid // disabled
        RED.log.info(`Assuming ${c_nrid} is deleted`)
        return undefined // deleted
      }
      let c_fdid = c_node.fd_id || c_node._fd_id // panel vs. widget
      if (!c_fdid) RED.log.warn(`Missing FlexDash ID for ${c_node.id})`)
      if (!c_fdid) console.log(c_node)
      // node is non-array
      if (!(c_nrid in array_topics)) return c_fdid
      // node is widget-array, add widgets for existing topics (see flat() at end of function)
      return array_topics[c_nrid].map(t => genArrayFDId(c_fdid, t))
    }).flat().filter(x=>x)
  }

  // update grid/panel children in the store, used when a widget is added/removed dynamically,
  // which happens with array-widgets
  function updateGridChildren(container) {
    const flow = container.config.kind == "SubflowPanel" ? container.z : null
    const child_nrids = parse_fd_children(container.config.fd_children)
    const child_fdids = genGridChildren(child_nrids, flow)
    if (container.config.kind.endsWith('Panel')) {
      container.fd.store.updateWidgetProp(container.fd_id, 'static', 'widgets', child_fdids)
    } else {
      container.fd.store.updateGrid(container.fd_id, {widgets: child_fdids})
    }
  }

  // ************************************************** FIXME
  // generate a widget from a node config and insert it into the store
  // kind: DateTime,Stat,Gauge,...; config: node.config; fd: flexdash dashboard node,
  // w_fdid: FlexDash ID for widget, array_id: FD group id (node.id)
  function addWidget(kind, config, fd, w_fdid, array_id) {
    if (!w_fdid) throw new Error("widget_id is required")
    // work out the props for the widget, skip FD and Node-RED internal stuff
    let props = {}
    const skip = {id:1, type:1, x:1, y:1, z:1, wires:1, _alias:1}
    for (const [k, v] of Object.entries(config)) {
      if (!k.startsWith('fd_') && !(k in skip)) props[k] = v
    }
    const fd_config = {
      id: w_fdid, kind: kind, rows: config.fd_rows, cols: config.fd_cols,
      static: props,
      dynamic: dynamics[w_fdid] || {},
      dyn_root: `node-red/${w_fdid}`,
      output: `nr/${w_fdid}`,
    }
    if (array_id != null) fd_config.group = array_id
    fd.store.addWidget(fd_config)
    return w_fdid
  }

  // add a topic to an array, which involves generating the corresponding widget
  // this is called from the Widget API when a message with a new topic appears
  function addWidgetTopic(node, topic) {
    const topics = array_topics[node.id]
    if (topics.includes(topic)) return
    
    // new topic: need to generate widget and then sort topics
    const w_id = genArrayFDId(node._fd_id, topic)
    addWidget(node._fd_kind, node._fd_config, node._fd, w_id, node.id)
    topics.push(topic)
    topics.sort()

    // regenerate the list of container's children (easier than trying to insert new widget)
    updateGridChildren(node._fd_container)
  }

  function deleteWidgetTopic(node, topic) {
    console.log("Deleting array-widget topic " + topic + " from " + node.id)
    // remove topic from array_topics
    const ix = array_topics[node.id].indexOf(topic)
    if (ix < 0) return
    array_topics[node.id].splice(ix, 1)
    // remove widget from container children
    updateGridChildren(node._fd_container)
    // remove widget from store
    const w_id = genArrayFDId(node._fd_id, topic)
    node._fd.store.deleteWidget(w_id)
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

      // express handler to get the list of pending mutations
      RED.httpAdmin.get("/_flexdash/mutations", (req, res) => {
        res.set('Content-Type', 'application/json')
        res.send(JSON.stringify(this.mutations))
      })

    }

    // convert a FlexDash ID to a node-red ID
    // HACK: if want_sfp is true, then for a subflow panel instance the template node is returned,
    // otherwise the subflow instance is returned. This hack is because in fd_children we have
    // subflow instance, but when a mutation of a SFP comes back we need to apply it to the
    // SFP template. This could be cleaned up by placing the SFP ID in fd_children, but that
    // messes with what happens in the flow editor...
    convert_id(fdid, want_sfp) {
      let nr_id = fdid.substring(1) // strip leading "type"
      if (nr_id.includes('|')) nr_id = nr_id.substring(0, nr_id.indexOf('|'))
      const node = RED.nodes.getNode(nr_id)
      if (node) {
        // special-case nodes in subflows
        if (node._alias) {
          if (!want_sfp && node.config && node.config.kind == 'SubflowPanel') return node.z // subflow instance
          return node._alias // subflow widget "template"
        }
      }
      return nr_id
    }

    // convert an array of FlexDash IDs to a comma-prefixed string of Node-RED IDs
    convert_ids(fdids) {
      let nrids = ""
      let prev_nrid = null
      for (const fdid of fdids) {
        const nr_id = this.convert_id(fdid)
        if (nr_id == prev_nrid) continue // repeated array-widgets
        nrids += ',' + nr_id
        prev_nrid = nr_id
      }
      return nrids
    }
    
    // save a mutation to the flow store, i.e., send it to the flow editor for persistence
    // kind is dash/tabs/grids/widgets -- second level in path ($config/<kind>/<id>?)
    saveMutation(fd_nrid, kind, el_fdid, config) { // topic has leading $config/
      this.mutation_seq++
      console.log(`FD mutation: fd=${fd_nrid} ${kind} ${el_fdid} ${JSON.stringify(config)}`)
      const cc = config
      config = Object.assign({}, config) // make a shallow copy
      if (kind == 'dash') {
        config.fd_children = this.convert_ids(config.tabs) // convert FlexDash IDs -> Node-RED IDs
        delete config.tabs
        this.mutations[fd_nrid] = config
      } else if (['tabs', 'grids', 'widgets'].includes(kind)) {
        // get the entire element config from the store
        if (!el_fdid) throw new Error(`cannot persist all ${kind}s at once`)
        // add Node-RED ID to config data before sending to flow editor
        const nr_id = this.convert_id(el_fdid, true)
        // sanity checks
        const node = RED.nodes.getNode(nr_id)
        if (node) {
          if (node._alias) {
            RED.log.error(`OOPS: updating a subflow instance, not a template: ${nr_id} ${node.type}`)
          }
        } else {
          const config = all_node_configs[nr_id]
          if (!config) throw new Error(`there is no node for ${fd_nrid}/${el_fdid}->${nr_id}`)
        }
        // convert FlexDash IDs -> Node-RED IDs
        if (kind == 'tabs') {
          config.fd_children = this.convert_ids(config.grids)
          delete config.grids
        } else if (kind == 'grids') {
          config.fd_children = this.convert_ids(config.widgets)
          delete config.widgets
        } else if (config.kind.endsWith("Panel")) {
          config.fd_children = this.convert_ids(config.static.widgets)
          config.static = Object.assign({}, config.static) // make a shallow copy
          delete config.static.widgets
          delete config.kind // subflow Panels come back as plain Panel, so avoid changing
        }
        delete config.dyn_root
        console.log(`FD mutation: ${nr_id} <- ${JSON.stringify(config)}`)
        this.mutations[nr_id] = config
      } else {
        throw new Error("Cannot persist " + kind)
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
      RED.log.info(`Node-RED FlexDash plugin version ${version}`)
    },
    // public functions
    initWidget, destroyWidget,
    // private stuff
    _genArrayFDId: genArrayFDId,
    _addWidgetTopic: addWidgetTopic,
    _deleteWidgetTopic: deleteWidgetTopic,
    _newNode(id, node, fd_config) { new_nodes[id] = fd_config; fd_containers[id] = node },
    _delNode(id) { delete fd_containers[id] },
    _register_subflow_panel(subflow_instance_id, panel_id) {
      subflow_panels[subflow_instance_id] = panel_id
    },
    _saveMutation: flow_persistence.saveMutation.bind(flow_persistence),
  }

  RED.plugins.registerPlugin("flexdash", plugin)

} catch(e) { console.log(`Error in ${__filename}: ${e.stack}`) }
}
