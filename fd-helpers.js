// Helper methods for FlexDash in Node-RED
// Copyright (c) 2021 by Thorsten von Eicken, see LICENSE

// the methods defined here will be mixed into the FlexDash config node object, thus 'this'
// will refer to that object.
module.exports = function(RED) {

  function findWidgetByNode(fd, node_id) {
    for (const [k, v] of Object.entries(fd.store.config.widgets)) {
      if (!v) fd.warn(`Null widget ${k}?? ${JSON.stringify(v)}\n${JSON.stringify(fd.store.config.widgets)}`)
      if (v.nr_node == node_id) return k
    }
    return null
  }
  
  // connectWidget ensures that the NR node has a corresponding widget in FlexDash and creates
  // one of the requested kind if it doesn't.
  function connectWidget(fd, config, widget_kind) {
    let widget_id = findWidgetByNode(fd, config.id)
    if (!widget_id) {
      // the NR node does not have a widget_id, we need to create a widget
      const tab_id = fd.store.tabIDByIX(0) // TODO: allow user to select tab
      const grid_id = fd.store.gridIDByIX(tab_id, 0) // TODO: allow user to select grid
      const widget_ix = fd.store.addWidget(grid_id, widget_kind)
      widget_id = fd.store.widgetIDByIX(grid_id, widget_ix)
      fd.store.updateWidget(widget_id, {nr_node: config.id})
    }
    return widget_id
  }

  return {
    // initWidget ensures that a widget for this node exists, creating it if it doesn't, and 
    // then initializing it's static params with the NR node's config
    // which is almost a clone of the config into the widget's "static" field
    // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
    // TimePlot, TreeView, etc.
    // If initWidget has to create the widget it sets config.fd_widget_id.
    initWidget(node, config, widget_kind) {
      this.log(`Initializing ${widget_kind} widget for node ${config.id}`)
      try {
        node.widget_id = connectWidget(this, config, widget_kind)
        let params = {}
        for (const [k, v] of Object.entries(config)) {
          if (k === 'fd' || k.startsWith('fd_')) continue
          params[k] = v
        }
        this.store.updateWidget(node.widget_id, { static: params, output: `nr/${node.id}` })
      } catch (e) {
        this.warn("Failed to initialize widget: " + e.stack)
      }
    },

    // updateWidget updates the widget's dynamic params with the passed params (typ. msg.params)
    // For each dynamic param we need to store the value in /node-red/<widget_id>/<param> and
    // ensure that the widget's dynamic/<param> field points there. Unless a param's value is
    // null, in which case we remove the pointer so the static value is used.
    updateWidget(node, params) {
      try {
        const w = this.store.widgetByID(node.widget_id)
        for (const [k, v] of Object.entries(params)) {
          if (!(k in w.static)) continue
          const path = `/node-red/${node.widget_id}/${k}`
          if (v === null) {
            // remove pointer to dynamic param, remove value
            this.store.updateWidgetProp(config.fd_widget_id, dynamic, k, null)
            this.store.insertData(path, undefined)
          } else {
            // set value, set pointer to dynamic param if it's not there
            this.store.insertData(path, v)
            if (!(k in w.dynamic)) this.store.updateWidgetProp(node.widget_id, dynamic, k, path)
          }
        }
      } catch (e) {
        this.warn("Failed to update widget: " + e.stack)
      }
    },

    // onInput registers the handler of a node so it gets it's corresponding widget's output
    onInput(node, handler) {
      if (typeof handler !== 'function') throw new Error("onInput handler must be a function")
      this.input_handlers[node.id] = handler
    }

  }
}
