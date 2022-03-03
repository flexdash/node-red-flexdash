// FlexDash nodes for Node-RED
// Copyright (c) 2021 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {
  return {

    setStatus(node, count) {
      if (count <= 0) node.status({fill:'grey', shape:'ring', text:'no connections'})
      else node.status({fill:'green', shape:'dot', text:`${count} connection${count>1?'s':''}`})
    },

    // connectWidget ensures that the NR node has a corresponding widget in FlexDash and creates
    // one of the requested kind if it doesn't.
    // The widget_kind refers to the Vue widget component name in FlexDash, e.g., PushButton,
    // TimePlot, TreeView, etc.
    // If connectWidget has to create the widget it sets config.fd_widget_id.
    connectWidget(fd, config, widget_kind) {
      if (config.fd_widget_id) {
        // the NR node has a widget_id, we should be able to find it in the FlexDash config...
        try {
          const w = fd.widgetByID(config.fd_widget_id) // throws if not found
          if (w.kind != widget_kind) {
            throw new Error(`Widget ${config.fd_widget_id} is a ${w.kind} but expected a ${widget_kind}`)
          }
          return
        } catch (e) {
          if (e instanceof fd.StoreError) {
            this.warn(`Widget ${config.fd_widget_id} unexpectedly not found in FlexDash store, creating new`)
          } else {
            throw e
          }
        }
      }
      // the NR node does not have a widget_id, we need to create a widget
      const tab_id = fd.tabIDByIX(0) // TODO: allow user to select tab
      const grid_id = fd.gridIDByIX(tab_id, 0) // TODO: allow user to select grid
      const widget_ix = fd.addWidget(grid_id, widget_kind)
      config.fd_widget_id = fd.widgetIDByIX(grid_id, widget_ix)
    },

  }
}
