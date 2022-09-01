// FlexDash ctrl node for Node-RED
// Control some innards of FlexDash, such as config nodes.
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  class flexdashCtrl {
    // config: name, fd_container
    constructor(config) {
      RED.nodes.createNode(this, config)

      const container = RED.nodes.getNode(config.fd_container)
      this.fd = container?.fd
      if (!this.fd) {
        node.warn(`Ctrl node is not part of any dashboard (ctrl node -> grid -> tab -> dashboard chain broken)`)
        return null
      }

      this.config = config

      this.on("close", () => {
        RED.plugins.get('flexdash').destroyCtrl(this)        
      })
      
      this.on("input", msg => {
        let target = RED.nodes.getNode(this.config.fd_container)
        if (target) {
          const fd_id = target.fd_id
          if (fd_id && fd_id[0] == 'g') {
            // updating a grid
            const g = this.fd.store.gridByID(fd_id)
            const update = {}
            for (const prop in msg) {
              if (prop in g) update[prop] = msg[prop]
            }
            this.log(`updating grid ${fd_id} with ${JSON.stringify(update)}`)
            if (update) this.fd.store.updateGrid(fd_id, update)
          // supporting widgets below needs some functions added to the store to update props
          // shouldn't need to update static/dynamic stuff 'cause one can do that directly on the widget?
          // } else if (fd_id && fd_id[0] == 'w') {
          //   // updating a panel
          //   const w = this.fd.store.WidgetByID(fd_id)
          //   const update = {}
          //   for (const prop in msg) {
          //     if (prop in g) update[prop] = msg[prop]
          //   }
          //   if (update.length > 0) this.fd.store.UpdateWidget(g, update)
          } else {

          }
        } else {
          this.error(`config node ${this.config.fd_container} not found`)
        }
      })

      const ctrl = RED.plugins.get('flexdash').initCtrl(this, container)
      ctrl.onInput((topic, payload, socket) => {
        // propagate the payload into the flow and attach the FD socket ID
        let msg = { payload: payload, _flexdash_socket: socket }
        if (topic != undefined) msg.topic = topic // FD topic has priority (unused?)
        else if (config.fd_output_topic) msg.topic = config.fd_output_topic // optional configured topic
        this.send(msg)
      })
    }
  }

  RED.nodes.registerType("flexdash ctrl", flexdashCtrl)
}
