// Store - Manages the data reflected to the dashboards, which consts of the "server data"
// that is displayed by the dashboard as well as the "config" of the dashboard itself.
// Copyright ©2021 Thorsten von Eicken, MIT license, see LICENSE file

// This file is a clone of store.js in the FlexDash repo, but adapted to use in
// Node-RED as opposed to Vue.js. The two versions need to be kept in sync and really
// should be merged, sigh.

// Use JSON instead of importing lodash.cloneDeep -- we only use it to create widgets and
// since this is infrequent going through JSON is not that awful
function cloneDeep(obj) { return JSON.parse(JSON.stringify(obj)) }

class StoreError extends Error {
  constructor (message) {
    super(message)
    this.name = 'StoreError'
    return this
  }
}

// ===== helper functions

// walkTree takes the root of an object hierarchy and an array of path components, then walks
// down the tree along the path and returns the final node in the tree.
function walkTree(root, path) {
  let node = root
  for (const d of path) {
    // handle empty path element (e.g. consecutive slashes
    if (d == '') {
      // do nothing

    // handle traversing an array, need to parse index into an int
    } else if (Array.isArray(node)) {
      const ix = parseInt(d, 10)
      if (Number.isNaN(ix)) {
        throw new StoreError(`Array index '${d}' in '${path}' is not an int`)
      } else if (ix < 0 || ix >= node.length) {
        throw new StoreError(`Array index '${d}' in '${path}' > ${node.length}`)
      }
      node = node[ix]

    // handle indexing into an object
    } else if (typeof node === 'object') {
      if (!(d in node) || typeof node[d] === 'undefined')
        node[d] = {} // allow new subtrees to be created
      node = node[d]

    } else {
      throw new StoreError(`Level '${d}' of '${path}'' is not traversable: ${typeof node[d]}`)
    }
  }
  return node
}

// ===== Store class

// There are two parts to the store class. One is primarily the set method, which is used to
// mutate the store, whether it's the $config portion or the dynamic data portion. This is
// called by anything that needs to update the store. Reading the store is done by directly
// accessing store.sd for the dynamic data portion.
// The second part consists of a set of functions that access and mutate the $config portion,
// which determines the structure of the dashboard, i.e. config of tabs, grids, panels, widgets.
// These functions access store.config or mutate it via qMutation, which itself calls set
// and then emits a message to all connected clients. This second set of functions is only
// called from Node-RED nodes that represent/implement widgets, they are not called in 
// response to incoming messages from dashboards, e.g. when the user edits a dashboard live.

// empty objects for addTab, addGrid, etc. The ID is missing and must be added!
const empty_tab = { icon: 'rocket-launch', title: "" }
const empty_grid = { kind: 'FixedGrid', title: "", widgets: [] }
const empty_widget = { kind: 'Stat', rows:1, cols:1, static:{title:"Stat"}, dynamic:{} }

class Store {
  constructor (config, emit) {
    this.emit = emit // socket.io emit function
    this.config = config // the dashboard's initial configuration
    this.sd = {} // server data, i.e. the data being visualized by the dashboard
    if (!this.config.dash?.title) this.initDash()
    return this
  }

  // insert "dynamic" data into the store
  // Interprets the path as a hierarchy of object "levels" separated by slashes and
  // mutates the data at the final path element.
  // If the path does not exist it is created using objects, i.e., arrays must be insrted
  // explicitly and cannot be created just by traversing a path.
  // If the type of the second to last path element (i.e. the last "directory" element) is
  // an array then a value can be appended by writing to one past the last index.
  set(path, value) {
    let pp = path.split("/") // split levels of hierarchy
    pp = pp.filter(p => p.length > 0) // remove empty components, e.g. leading slash
    if (pp.length == 0) throw new StoreError("Cannot replace entire hierarchy")

    let root = this.sd
    if (pp[0] === '$config') {
      if (pp.length == 1) throw new StoreError("Cannot replace entire $config")
      pp.shift() // remove $config
      root = this.config
    }
    const p = pp.pop() // separate off last level
    const dir = walkTree(root, pp)
    // now dir[p] is the field to update

    // perform the update
    if (Array.isArray(dir)) {
      // if we're updating an array, the last path component must be the index
      const ix = parseInt(p, 10)
      if (!Number.isNaN(ix)) {
        if (ix >= 0 && ix < dir.length) {
          if (value === undefined)
            throw new StoreError(`Cannot delete array element '${ix}' in '${path}'`)
          //console.log(`Updated array elt ${path} with`, value)
          dir[ix] = value
        } else if (ix == dir.length) {
          if (value === undefined)
            throw new StoreError(`Array index '${ix}' in '${path}' >= ${dir.length}`)
          //console.log(`Appended array elt ${path} with`, value)
          dir.push(value)
        } else {
          throw new StoreError(`Array index '${ix}' in '${path}' > ${dir.length}`)
        }
      } else {
        throw new StoreError(`Array index '${p}' is not a number`)
      }
    } else if (typeof(dir) === 'object') {
      if (value !== undefined) {
        //console.log(`Updated ${path} with:`, value)
        dir[p] = value
      } else {
        //console.log(`Deleted ${path}`)
        delete dir[p]
      }
    } else {
      throw new StoreError(`${pp.join('/')} is neither Array nor Object`)
    }
  }

  // qMutation in the central function through which all mutations to the config must be
  // funneled. It applies the mutation locally and sends it to all the dashboards.
  // The tagline is a string that is unused (it is used with undo on the dashboard side).
  // Msgs is an array of [path, value] tuples with the leading "$config/" omitted from the path.
  qMutation(tagline, msgs) {
    //console.log("queueing mutation", tagline) //, JSON.stringify(msgs))
    // update our copy of the store
    for (const m of msgs) {
      this.set("$config/" + m[0], m[1])
    }

    // send the mutation to the server
    for (const m of msgs) {
      this.sendMutation(m[0])
    }
  }

  // sendMutation forwards the data touched by a mutation to the dashboards.
  // Always send a top-level config topic or a complete object one level
  // down (e.g. a complete tab, grid, widget).
  sendMutation(topic) {
    const tt = topic.split('/') // tt = top-level config topic
    let t = '$config/' + tt[0]
    let d = this.config[tt[0]]
    if (tt.length > 1) {
      t += '/' + tt[1]
      d = d[tt[1]]
    }
    this.emit("set", t, d)
  }

  // generate an id for a new item in a collection
  // example: to generate a new widget ID use genId(store.config.widgets, "w")
  genId(collection, prefix) {
    let id = null
    while (!id || id in collection) {
      id = "00000" + Math.floor(Math.random() * 10000)
      id = prefix + id.substring(id.length-5)
    }
    return id
  }

  // ===== Getters with error checks

  tabByID(id) {
    const tab = this.config.tabs[id]
    if (tab && tab.id == id) return tab
    throw new StoreError(`tab ${id} does not exist`)
  }

  gridByID(id) {
    const grid = this.config.grids[id]
    if (grid && grid.id == id) return grid
    throw new StoreError(`grid ${id} does not exist`)
  }

  widgetByID(id) {
    const widget = this.config.widgets[id]
    if (widget && widget.id == id) return widget
    throw new StoreError(`widget ${id} does not exist`)
  }

  tabIDByIX(ix) {
    const tabs = this.config.dash.tabs
    if (tabs && ix >= 0 && ix < tabs.length) return tabs[ix]
    throw new StoreError(`tab #${ix} does not exist`)
  }

  // tab may be a tab_id (string) or a tab object
  gridIDByIX(tab, ix) {
    if (typeof tab === 'string') tab = this.tabByID(tab)
    if (tab && ix >= 0 && ix < tab.grids.length) return tab.grids[ix]
    throw new StoreError(`grid #${ix} does not exist in tab ${tab.id}`)
  }

  // grid may be a grid_id (string) or a grid object
  widgetIDByIX(grid, ix) {
    if (typeof grid === 'string') grid = this.gridByID(grid)
    if (grid && ix >= 0 && ix < grid.widgets.length) return grid.widgets[ix]
    throw new StoreError(`widget #${ix} does not exist in grid ${grid&&grid.id}`)
  }

  // panel may be a panel_id (string) or a panel object
  widgetIDByPanelIX(panel, ix) {
    if (typeof panel === 'string') panel = this.widgetByID(panel)
    if (panel && ix >= 0 && ix < panel.static.widgets.length) return panel.static.widgets[ix]
    throw new StoreError(`widget #${ix} does not exist in panel ${panel&&panel.id}`)
  }

  // ===== Operations on the dash

  // initDash initializes an empty dash with a tab and a grid, all empty...
  initDash() {
    this.config = { dash: {}, tabs: {}, grids: {}, widgets: {} }

    this.qMutation("initDash", [
      ["widgets", {}],
      ["grids", { g00001: { id: 'g00001', kind: 'FixedGrid', widgets: [] } }],
      ["tabs", { t00001: { id: 't00001', icon: "view-dashboard", grids: ["g00001"] } }],
      ["dash", { title: "FlexDash", tabs: ['t00001'] }],
    ])
  }

  // updateDash given props to update (an object that gets merged into existing props)
  updateDash(props) {
    this.qMutation(`update dash ${Object.keys(props).join(",")}`,
      Object.entries(props).map(([k,v]) => [`dash/${k}`, v])
    )
  }


  // ===== Operations on tabs

  // addTab adds a new tab and initializes it either with an empty grid or empty URL
  // returns the index of the new tab
  addTab(kind) {
      const tab_id = this.genId(this.config.tabs, "t")
      const tab_ix = this.config.dash.tabs.length
      if (kind === 'grid') {
        const grid_id = this.genId(this.config.grids, "g")
        this.qMutation("add a grid tab", [
          [`grids/${grid_id}`, {  ...cloneDeep(empty_grid), id: grid_id }],
          [`tabs/${tab_id}`, { ...cloneDeep(empty_tab), id: tab_id, grids: [grid_id] }],
          [`dash/tabs/${tab_ix}`, tab_id ],
        ])
      } else if (kind === 'iframe') {
        this.qMutation("add an iframe tab", [
          [`tabs/${tab_id}`, { ...cloneDeep(empty_tab), id: tab_id, slot: 'a', url: "" }],
          [`dash/tabs/${tab_ix}`, tab_id ],
        ])
      } else {
        throw new StoreError(`unknown tab type ${kind}`)
      }
    return tab_ix
  }

  // deleteTab with index ix
  deleteTab(ix) {
    const tab_id = this.tabIDByIX(ix)
    // collect the IDs of the grids and widgets we need to delete
    const grids = this.tabByID(tab_id).grids
    const widgets = grids.map(g => this.config.grids[g].widgets).flat()

    // construct mutation to delete the whole shebang
    this.qMutation("delete a tab", [ // FIXME: add tab title to the message once implemented
        [ `dash/tabs`, this.config.dash.tabs.filter((t,i) => i != ix) ],
        [ `tabs/${tab_id}`, undefined ],
        ...grids.map(g => [ `grids/${g}`, undefined ]),
        ...widgets.map(w => [ `widgets/${w}`, undefined ]),
    ])
  }

  // updateTab given ID and props to update (an object that gets merged into existing props)
  updateTab(tab_id, props) {
    this.tabByID(tab_id) // just for the sanity check
    this.qMutation(`update tab ${Object.keys(props).join(",")}`,
      Object.entries(props).map(([k,v]) => [`tabs/${tab_id}/${k}`, v])
    )
  }

  // updateDash props (an object that gets merged into existing props)
  updateDash(props) {
    this.qMutation(`update dash ${Object.keys(props).join(",")}`,
      Object.entries(props).map(([k,v]) => [`dash/${k}`, v])
    )
  }

  // ===== Operations on grids

  // addGrid adds a new grid to a tab and initializes it with an empty set of widgets
  // returns the index of the new grid in tab.grids
  addGrid(tab_id) {
    const tab = this.tabByID(tab_id)
    const grid_id = this.genId(this.config.grids, "g")
    const grid_ix = tab.grids.length
    this.qMutation("add a grid", [ // FIXME: add tab name when implemented
      [`grids/${grid_id}`, { ...cloneDeep(empty_grid), id: grid_id } ],
      [`tabs/${tab_id}/grids/${grid_ix}`, grid_id ],
    ])
    return grid_ix
  }

  // deleteGrid with index ix from tab tab_id
  deleteGrid(tab_id, ix) {
    const tab = this.tabByID(tab_id)
    const grid_id = this.gridIDByIX(tab, ix)
    const grid = this.gridByID(grid_id)
    // construct mutation to delete the grid and its widgets
    this.qMutation("delete a grid", [ // FIXME: add tab title to the message once implemented
      [ `tabs/${tab_id}/grids`, tab.grids.filter((g,i) => i != ix) ],
      [ `grids/${grid_id}`, undefined ],
      ...grid.widgets.map(w => [ `widgets/${w}`, undefined ]),
    ])
  }

  // updateGrid given ID and props to update (an object that gets merged into existing props)
  updateGrid(grid_id, props) {
    this.gridByID(grid_id) // just for the sanity check
    this.qMutation(`update grid ${Object.keys(props).join(",")}`,
      Object.entries(props).map(([k,v]) => [`grids/${grid_id}/${k}`, v])
    )
  }

  // ===== Operations on widgets

  // addWidget adds a new widget of the specified kind to a grid
  // returns the index of the new widget in the grid
  addWidget(grid_id, kind, widget_id=null) {
    const grid = this.gridByID(grid_id)
    widget_id = widget_id || this.genId(this.config.widgets, "w")
    const widget_ix = grid.widgets.length
    this.qMutation("add a widget", [ // FIXME: add tab name when implemented
      [`widgets/${widget_id}`,
        { ...cloneDeep(empty_widget), id: widget_id, kind, static:{title:kind}, dynamic:{} } ],
      [`grids/${grid_id}/widgets/${widget_ix}`, widget_id ],
    ])
    return widget_ix
  }

  // addPanelWidget adds a new widget of the specified kind to a panel (which is a widget)
  // returns the index of the new widget in the panel
  addPanelWidget(panel_id, kind) {
    const panel = this.widgetByID(panel_id)
    const widget_id = this.genId(this.config.widgets, "w")
    const widget_ix = panel.static.widgets.length
    this.qMutation("add a widget", [ // FIXME: add tab name when implemented
      [`widgets/${widget_id}`,
        { ...cloneDeep(empty_widget), id: widget_id, kind, static:{title:kind}, dynamic:{} } ],
      [`widgets/${panel_id}/static/widgets/${widget_ix}`, widget_id ],
    ])
    return widget_ix
  }

  // deleteWidget with index ix from grid grid_id
  deleteWidget(grid_id, ix) {
    const grid = this.gridByID(grid_id)
    const widget_id = this.widgetIDByIX(grid, ix)
    // construct mutation to delete the widget
    this.qMutation("delete a widget", [ // add tab title to the message once implemented
      [ `grids/${grid_id}/widgets`, grid.widgets.filter((w,i) => i != ix) ],
      [ `widgets/${widget_id}`, undefined ],
    ])
  }

  // deletePanelWidget with index ix from panel panel_id
  deletePanelWidget(panel_id, ix) {
    const panel = this.widgetByID(panel_id)
    const widget_id = this.widgetIDByPanelIX(panel, ix)
    // construct mutation to delete the widget
    this.qMutation("delete a widget", [ // add tab title to the message once implemented
      [ `widgets/${panel_id}/static/widgets`, panel.static.widgets.filter((w,i) => i != ix) ],
      [ `widgets/${widget_id}`, undefined ],
    ])
  }

  // updateWidget given ID and props to update (an object that gets merged into existing props)
  updateWidget(widget_id, props) {
    this.widgetByID(widget_id) // just for the sanity check
    this.qMutation(`update widget ${Object.keys(props).join(",")}`,
      Object.entries(props).map(([k,v]) => [`widgets/${widget_id}/${k}`, v])
    )
  }

  // updateWidgetProp, which is static|dynamic, prop is key within that
  updateWidgetProp(widget_id, which, prop, value) {
    this.widgetByID(widget_id) // just for the sanity check
    this.qMutation(`update widget prop ${which}:${prop} <- ${value}`,
      [[`widgets/${widget_id}/${which}/${prop}`, value]]
    )
  }

  // move a widget from one container (grid or panel) to another
  moveWidget(widget_id, src_id, dst_id) {
    const w = this.widgetByID(widget_id)
    const src_is_grid = src_id.startsWith('g')
    const dst_is_grid = dst_id.startsWith('g')
    // construct operation to remove widget from where it's now
    if (src_is_grid) {
      const src = this.gridByID(src_id)
      var del_op = [ `grids/${src_id}/widgets`, src.widgets.filter((w) => w != widget_id) ]
    } else {
      const src = this.widgetByID(src_id) // get panel
      var del_op = [ `widgets/${src_id}/static/widgets`, src.static.widgets.filter((w) => w != widget_id) ]
    }
    // construct operation to add widget to destination grid/panel
    if (dst_is_grid) {
      const dst = this.gridByID(dst_id)
      const ix = dst.widgets.length
      var add_op = [ `grids/${dst_id}/widgets/${ix}`, widget_id ]
    } else {
      const dst = this.widgetByID(dst_id) // get panel
      const ix = dst.static.widgets.length
      var add_op = [ `widgets/${dst_id}/static/widgets/${ix}`, widget_id ]
    }
    // resize if needed 'cause panel grid is half of regular grid
    var resize_op = []
    if (src_is_grid && !dst_is_grid) {
      resize_op = [ `widgets/${widget_id}/cols`, w.cols*2]
    } else if (!src_is_grid && dst_is_grid) {
      resize_op = [ `widgets/${widget_id}/cols`, Math.ceil(w.cols/2)]
    }

    var ops = [ del_op, resize_op, add_op ].filter((o) => o != null)
    console.log(`Widget move ops = ${JSON.stringify(ops)}`)
    this.qMutation("move widget to another grid/panel", ops)
  }

}

module.exports = { Store, StoreError, walkTree }
