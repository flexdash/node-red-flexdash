// FlexDash plugin for Node-RED - core functions and data structures to support flexdash
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

let path = require("path")
const sfc_compiler = require("./sfc-compiler")

const debug = true // debug printing of hierarchy on flows-start

// The plugin exported here provides globals that nodes can call without having a
// handle onto any flexdash object.
module.exports = function (RED) {
  try {
    // use try-catch to get stack backtrace of any error

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

    // For each widget "template" node in some subflow provide a map of subflow instance ID to the
    // corresponding instantiated node.
    let subflow_widgets = {} // key: nr_id of config/template node, value: { sfi_id: node_id }

    // For each subflow instance node that has a panel link to the panel node
    let subflow_panels = {} // key: nr_id of subflow instance, value: panel node ID

    // generate a FlexDash ID from a "plain" FD ID for an array widget
    function genArrayFDId(fd_id, topic) {
      return fd_id + "|" + topic.toString()
    }

    function forAllContainers(cb) {
      for (const id in fd_containers) {
        cb(fd_containers[id])
      }
    }

    // initWidget creates a widget for this node, and then initializing its static params with the
    // NR node's config which is almost a clone of the config into the widget's "static" field.
    // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
    // TimePlot, TreeView, etc.
    // initWidget returns a handle onto the Widget API functions to manipulate the widget.
    function initWidget(node, config, widget_kind) {
      // ensure we can produce a stack backtrace on error
      try {
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
          node.warn(
            `Widget node is not part of any dashboard (widget node [-> panel] -> grid -> tab -> dashboard chain broken)`
          )
          return null
        }

        // handle widgets in subflows
        if (node._alias) {
          // _alias: the node's template, z: the subflow instance ID, container: panel instance
          if (container.config.kind != "SubflowPanel") {
            node.warn(`Widget node must belong to a SubflowPanel because it is in a subflow`)
            return null
          }
          // register that this node is an instantiation in a subflow
          const tmpl_id = node._alias
          if (!subflow_widgets[tmpl_id]) subflow_widgets[tmpl_id] = {}
          subflow_widgets[tmpl_id][node.z] = node.id
        }
        node._fd = fd
        node._fd_container = container
        node._fd_id = "w" + node.id
        node._fd_config = config

        // ensure widget is in it's container's fd_children array
        if (typeof container.config?.fd_children == "string") {
          // if fd_children is not a string it will be caught on flow-start
          let nrid = node._alias || node.id // if this is a subflow widget/panel then _alias
          // verify that the widget is in the container's fd_children
          if (!container.config.fd_children.includes(`,${nrid}`)) {
            RED.log.warn(`FlexDash initWidget: adding ${node.id} at end of container ${container.id} (${container.config.fd_children})`)
            container.config.fd_children += ',' + nrid
          }
        }

        // widget array
        if (config.fd_array) {
          //RED.log.debug(`Widget ${widget_id} is an array up to ${config.fd_array_max}`)
          node._fd_array_max = config.fd_array_max
          node._fd_kind = widget_kind

          // create widgets for existing topics
          if (!(node.id in array_topics)) array_topics[node.id] = []
          const topics = array_topics[node.id]
          if (topics.length > node._fd_array_max) {
            topics = topics.slice(0, node._fd_array_max)
            RED.log.warn(`FlexDash initWidget: array widget ${node.id} has more topics than max`)
          }
          for (const topic of topics) {
            const fd_id = genArrayFDId(node._fd_id, topic)
            addWidget(widget_kind, config, fd, fd_id, config.id)
          }

          // non-array widget
        } else {
          node._fd_kind = widget_kind
          if (config.fd_output_topic) node._fd_output_topic = config.fd_output_topic
          addWidget(widget_kind, config, fd, node._fd_id)
        }

        node.on("close", () => destroyWidget(node))
        return new WidgetAPI(node, plugin)
      } catch (e) {
        RED.log.warn(
          `FlexDash initWidget: failed to initialize widget for node '${node.id}': ${e.stack}`
        )
        return null
      }
    }

    function destroyWidget(node) {
      try {
        // ensure we can produce a stack backtrace
        RED.log.debug(`Destroying ${node._fd_kind} widget for node ${node.id}`)
        const widget_id = node._fd_id
        if (!widget_id) return // initWidget must have bailed...
        const fd = node._fd
        const widgets =
          node.id in array_topics
            ? array_topics[node.id].map(t => genArrayFDId(widget_id, t))
            : [widget_id]
        // we don't clear array_topics[node.id] here because the node may be immediately re-created if
        // it's just being re-deployed with changes
        for (const w_id of widgets) {
          // save away the "dynamic" settings for this widget (selects static/dynamic value per prop)
          const w = fd.store.config.widgets[w_id]
          if (w?.dynamic) dynamics[w_id] = w.dynamic
          fd.store.deleteWidget(w_id)
        }

        // clean subflow_widgets
        if (node._alias) subflow_widgets.delete(node._alias)
      } catch (e) {
        RED.log.warn(`FlexDash destroyWidget: '${node.id}': ${e.stack}`)
      }
    }

    // initCtrl creates an interface for a FD ctrl node so it can receive messages
    function initCtrl(node) {
      try {
        // ensure we can produce a stack backtrace
        RED.log.debug(`Initializing ctrl for node ${node.id}`)

        return {
          // onInput registers the handler of a node
          onInput(handler) {
            if (typeof handler !== "function") throw new Error("onInput handler must be a function")
            const ix = node.fd.ctrlHandlers.findIndex(h => h.node === node)
            if (ix >= 0) node.fd.ctrlHandlers[ix] = { node, handler }
            else node.fd.ctrlHandlers.push({ node, handler })
          },
        }
      } catch (e) {
        RED.log.warn(
          `FlexDash initCtrl: failed to initialize widget for node '${node.id}': ${e.stack}`
        )
        return null
      }
    }

    function destroyCtrl(node) {
      try {
        // ensure we can produce a stack backtrace
        // remove handler for this node
        const ix = node.fd.ctrlHandlers.findIndex(h => h.node === node)
        if (ix >= 0) node.fd.ctrlHandlers.splice(ix, 1)
      } catch (e) {
        RED.log.warn(`FlexDash destroyCtrl: '${node.id}': ${e.stack}`)
      }
    }

    // Generate the FlexDash config for config nodes (dash/tab/grid/panel) from the Node-RED config.
    // This happens at the time a deploy is complete because then all active nodes are instantiated,
    // so following fd_children works,
    // We regenerate _all_ FD config nodes because there are too many corner cases when
    // enabling/disabling flows.
    RED.events.on("flows:started", info => {
      try {
        RED.log.debug(`\n***** flows:started ${info.type} diff: ${JSON.stringify(info.diff || {})}`)
        // RED.log.debug("New nodes: " + Object.keys(new_nodes).join(' '))

        // Remove deleted nodes from subflow_panels
        const new_sp = {}
        for (const id in subflow_panels) if (RED.nodes.getNode(id)) new_sp[id] = subflow_panels[id]
        subflow_panels = new_sp

        // console.log(`subflow_widgets: ${JSON.stringify(subflow_widgets)}`)
        // console.log(`subflow_panels: ${JSON.stringify(subflow_panels)}`)

        // generate FlexDash config for all deployed config nodes
        if (debug) console.log("===== FlexDash config begin =====")
        for (const id in fd_containers) {
          const node = fd_containers[id]
          const config = node.config
          //RED.log.debug("Generating config for " + config.type, config.id, `kind=${config.kind}`)

          if (!("fd_children" in config)) RED.log.warn("Error: no fd_children in", config)

          if (debug) {
            const kind = config.kind ? config.kind : config.type.replace(/flexdash /, "")
            let info = `FD ${config.id} ${kind} "${config.name || config.title || ""}"`
            for (const k of ["z", "parent", "tab", "fd", "fd_container"])
              if (config[k]) info += ` ${k}=${config[k]}`
            //if (child_fdids.length > 0) info += `\n   ${child_fdids.join(' ')}`
            console.log(info)
          }

          // convert children Node-RED IDs to FlexDash IDs, create/flag missing children
          if (typeof config.fd_children !== "string") {
            RED.log.warn(
              `Node '${node.id}' has non-string fd_children: ${typeof config.fd_children} ${
                config.fd_children
              }`
            )
            continue
          }
          const cc_nrids = parse_fd_children(config.fd_children)
          if (config.fd_children.includes(",,")) {
            RED.log.warn(
              `Node '${node.id}' has ,, in fd_children: ${config.fd_children} (${node.type}|${node.name}|${node.title})`
            )
          }
          let child_fdids
          if (node.type == "flexdash dashboard" || node.type == "flexdash tab") {
            child_fdids = genDashTabChildren(cc_nrids)
          } else if (node.config.kind == "SubflowPanel") {
            child_fdids = genGridChildren(cc_nrids, node.z, debug)
          } else {
            // panel or grid
            child_fdids = genGridChildren(cc_nrids, null, debug)
          }

          // add config to store
          const fd_config = new_nodes[config.id]
          switch (node.type) {
            case "flexdash dashboard":
              node.store.updateDash({ tabs: child_fdids })
              break
            case "flexdash tab":
              if (fd_config) node.fd.store.addTab({ ...fd_config, grids: child_fdids })
              else node.fd.store.updateTab(node.fd_id, { grids: child_fdids })
              break
            case "flexdash iframe":
              if (fd_config) node.fd.store.addTab({ ...fd_config })
              else node.fd.store.updateTab(node.fd_id, {})
              break
            case "flexdash container":
              if (node.config.kind.endsWith("Grid")) {
                if (fd_config) node.fd.store.addGrid({ ...fd_config, widgets: child_fdids })
                else node.fd.store.updateGrid(node.fd_id, { widgets: child_fdids })
              } else {
                // panel
                if (fd_config) node.fd.store.addWidget(fd_config)
                node.fd.store.updateWidgetProp(node.fd_id, "static", "widgets", child_fdids)
              }
              break
          }
        }
        if (debug) console.log("===== FlexDash config end =====")


        // stop queuing mutations in all stores
        for (const fd of Object.values(fd_containers).filter(c => c.type == "flexdash dashboard")) {
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
      for (const fd of Object.values(fd_containers).filter(c => c.type == "flexdash dashboard")) {
        //if (fd) RED.log.info("Queueing mutations for " + fd.id)
        if (fd) fd.store.do_queue = true
      }
    })

    // parse a container's fd_children: a comma-separated list of Node-RED IDs, with leading comma
    function parse_fd_children(fd_children) {
      const nrids = fd_children.split(",")
      if (nrids[0] == "") nrids.shift() // leading comma
      // deduplicate (being defensive)
      const c = {},
        ret = []
      for (const nrid of nrids) {
        if (nrid in c) continue
        if (nrid == "") {
          RED.log.warn(`FD: Empty ID in fd_children: ${fd_children}`)
          continue
        }
        c[nrid] = true
        ret.push(nrid)
      }
      return ret
    }

    // generate config node children, i.e., children of dash and tabs
    // returns an array of FlexDash IDs
    function genDashTabChildren(child_nrids) {
      return child_nrids
        .map(c_nrid => {
          let c_node = RED.nodes.getNode(c_nrid)
          if (c_node) {
            const config = c_node.config
            if (debug) {
              const name = config?.name || config?.title || c_node.name
              console.log( `   ${c_nrid}   ${c_node.type} "${name}"`)
            }
            return c_node.fd_id || c_node._fd_id // node is active, easy...
          } else {
            if (debug) console.log(`   ${c_nrid}   disabled/deleted node`)
            return undefined // disabled or deleted
          }
        })
        .filter(x => x)
    }

    // generate grid/panel children
    // returns an array of FlexDash IDs
    function genGridChildren(child_nrids, flow_nrid, debug) {
      return child_nrids
        .map(c_nrid => {
          // handle subflow nodes
          const c_nrid_orig = c_nrid
          if (subflow_widgets[c_nrid]) c_nrid = subflow_widgets[c_nrid][flow_nrid]
          else if (subflow_panels[c_nrid]) c_nrid = subflow_panels[c_nrid]
          if (!c_nrid)
            throw new Error(
              `Failure converting subflow widget ${c_nrid_orig} for flow ${flow_nrid}`
            )
          //if (!c_nrid) console.log("Failure converting subflow widget nrid for flow " + flow_nrid)
          let c_node = RED.nodes.getNode(c_nrid)
          if (!c_node) {
            if (debug) console.log(`   ${c_nrid}   disabled/deleted node`)
            return undefined // disabled or deleted
          }
          let c_fdid = c_node.fd_id || c_node._fd_id // panel vs. widget
          if (!c_fdid) {
            RED.log.warn(`Missing FlexDash ID for ${c_node.id})`)
            console.log(c_node)
            return undefined
          }
          if (debug) {
            const config = c_node._fd_config || c_node.config
            const name = config?.name || config?.title || c_node.name
            console.log( `   ${c_nrid}   ${c_node.type} "${name}"`)
          }
          // node is non-array
          if (!(c_nrid in array_topics)) return c_fdid
          // node is widget-array, add widgets for existing topics (see flat() at end of function)
          return array_topics[c_nrid].slice(0, c_node._fd_array_max).map(t => genArrayFDId(c_fdid, t))
        })
        .flat()
        .filter(x => x)
    }

    // update grid/panel children in the store, used when a widget is added/removed dynamically,
    // which happens with array-widgets
    function updateGridChildren(container) {
      const flow = container.config.kind == "SubflowPanel" ? container.z : null
      const child_nrids = parse_fd_children(container.config.fd_children)
      const child_fdids = genGridChildren(child_nrids, flow, false)
      if (container.config.kind.endsWith("Panel")) {
        container.fd.store.updateWidgetProp(container.fd_id, "static", "widgets", child_fdids)
      } else {
        container.fd.store.updateGrid(container.fd_id, { widgets: child_fdids })
      }
    }

    // generate a widget from a node config and insert it into the store
    // kind: DateTime,Stat,Gauge,...; config: node.config; fd: flexdash dashboard node,
    // w_fdid: FlexDash ID for widget, array_id: FD group id (node.id)
    function addWidget(kind, config, fd, w_fdid, array_id) {
      if (!w_fdid) throw new Error("widget_id is required")
      // work out the props for the widget, skip FD and Node-RED internal stuff
      let props = {}
      const skip = { id: 1, type: 1, x: 1, y: 1, z: 1, wires: 1, _alias: 1 }
      for (const [k, v] of Object.entries(config)) {
        if (!k.startsWith("fd_") && !(k in skip)) props[k] = v
      }
      const fd_config = {
        id: w_fdid,
        kind: kind,
        rows: config.fd_rows,
        cols: config.fd_cols,
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

    // ===== Exports

    const plugin = {
      type: "dashboard", // gotta make something up...
      onadd: () => {
        const version = require(path.join(__dirname, "/package.json")).version
        RED.log.info(`Node-RED FlexDash plugin version ${version}`)
      },
      // public functions
      initWidget,
      destroyWidget,
      initCtrl,
      destroyCtrl,
      // private stuff
      _genArrayFDId: genArrayFDId,
      _addWidgetTopic: addWidgetTopic,
      _deleteWidgetTopic: deleteWidgetTopic,
      _newNode(id, node, fd_config) {
        new_nodes[id] = fd_config
        fd_containers[id] = node
      },
      _delNode(id) {
        delete fd_containers[id]
      },
      _register_subflow_panel(subflow_instance_id, panel_id) {
        subflow_panels[subflow_instance_id] = panel_id
      },
      _forAllContainers: forAllContainers,
      _sfc_compiler: sfc_compiler,
    }

    RED.plugins.registerPlugin("flexdash", plugin)
  } catch (e) {
    console.log(`Error in ${__filename}: ${e.stack}`)
  }
}
