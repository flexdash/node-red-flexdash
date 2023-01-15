// FlexDash ctrl node for Node-RED
// Control some innards of FlexDash, such as config nodes.
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function (RED) {
  class flexdashCtrl {
    // config: name, fd_container
    constructor(config) {
      RED.nodes.createNode(this, config)

      this.fd = RED.nodes.getNode(config.fd)
      if (!this.fd) {
        this.warn(`Ctrl node is not associated with any dashboard ${JSON.stringify(config)}`)
        return null
      }

      this.config = config

      this.on("close", () => {
        RED.plugins.get("flexdash").destroyCtrl(this)
      })

      this.on("input", msg => {
        if (!msg.action || typeof msg.action != "string") {
          this.error(`invalid msg.action, must be string identifying action to perform`)
          return
        }

        let kind, filter, getter, setter
        if (msg.tab) {
          ;(kind = "tab"), (filter = node => node.type == "flexdash tab")
          getter = this.fd.store.tabByID
          setter = this.fd.store.updateTab
        } else if (msg.grid) {
          kind = "grid"
          filter = node => node.type == "flexdash container" && node.config?.kind?.endsWith("Grid")
          getter = this.fd.store.gridByID
          setter = this.fd.store.updateGrid
        } else if (msg.panel) {
          kind = "panel"
          filter = node => node.type == "flexdash container" && node.config?.kind?.endsWith("Panel")
          getter = this.fd.store.widgetByID
          setter = this.fd.store.updateWidget
        } else {
          this.error(`invalid msg, must contain tab, grid or panel`)
          return
        }

        if (typeof msg[kind] != "string") {
          this.error(`invalid msg.${kind}, must be string identifying target FlexDash element`)
          return
        }

        // see whether we can identify the target of the message: check against node.id,
        // node.name, node.title, node.icon in that order
        let target = RED.nodes.getNode(msg[kind]) // shot in the dark: is it a node ID?
        if (target) {
          if (!target.fd || !filter(target)) {
            this.error(`node "${msg[kind]}" is not a FlexDash ${kind}`)
            return
          }
        } else {
          // iterate through FlexDash config nodes and see whether something matches uniquely
          for (const field of ["name", "title", "icon"]) {
            let error = false
            RED.plugins.get("flexdash")._forAllContainers(node => {
              if (filter(node) && node.config && node.config[field] == msg[kind]) {
                if (target) {
                  this.error(
                    `the ${field} of multiple FlexDash ${kind}s matches "${msg[kind]}", message ignored`
                  )
                  error = true
                } else {
                  target = node
                }
              }
            })
            if (error) return
            if (target) break
          }
          if (!target) {
            // a warning is probably good here, but it's not necessarily an error
            this.warn(`no FlexDash ${kind} with id/name/title/icon "${msg[kind]}" found`)
            return
          }
        }

        // perform
        switch (msg.action) {
          // open/close are ctrl messages that change the browsing state without affecting the config
          case "open":
          case "close":
            if ((kind == "tab" && msg.action == "open") || kind == "grid") {
              const payload = { action: msg.action, type: kind, id: target.fd_id }
              this.fd._send("ctrl", null, payload, msg._fd_socket)
            } else {
              this.error(`cannot ${msg.action} a ${kind}`)
            }
            break
          // edit changes the config and as a side-effect changes the browser state
          case "edit":
            const el = getter(target.fd_id) // get the FlexDash object we're editing
            // perform the update
            const update = {}
            const exclude = ["id", "kind", "static", "dynamic", "dyn_root", "output"]
            for (const prop in msg) {
              if (prop in el && !exclude.includes(prop)) update[prop] = msg[prop]
            }
            this.log(`updating ${kind} ${target.fd_id} with ${JSON.stringify(update)}`)
            if (update) {
              if (msg._fd_socket) {
                // implementing this is messy, would have to refactor the code in the store that
                // constructs the correct store path so that it can be used without causing a mutation
                // until someone has a pertinent use-case for this, punt...
                this.error(`msg._fd_socket not supported for action ${msg.action}`)
              } else {
                setter(fd_id, update)
              }
            }
            break
          default:
            this.error(`unknown action "${msg.action}"`)
        }
      })

      const ctrl = RED.plugins.get("flexdash").initCtrl(this)
      ctrl.onInput((topic, payload, socket) => {
        // propagate the payload into the flow and attach the FD socket ID
        let msg = { payload, _fd_socket: socket }
        if (topic != undefined) msg.topic = topic // FD topic has priority (unused?)
        else if (config.fd_output_topic) msg.topic = config.fd_output_topic // optional configured topic
        this.send(msg)
      })
    }
  }

  RED.nodes.registerType("flexdash ctrl", flexdashCtrl)
}
