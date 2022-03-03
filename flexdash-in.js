// FlexDash-in node for Node-RED
// Copyright (c) 2021 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {
  const { setStatus } = require("./fd-helpers.js")(RED)

  // flexdash-in node, receives messages from dashboards
  function flexdashIn(n) {
    RED.nodes.createNode(this, n)
    this.name = n.name
    this.config_node = RED.nodes.getNode(n.server)
    this.count = 0

    this.config_node.io.on("connection", (socket) => {
      this.count += 1
      setStatus(this, this.count)

      // handle incoming messages
      socket.on('msg', (topic, payload) => {
        const msg = {
          topic       : topic || "",
          payload     : payload || null,
          _flexdash_id: socket.id,
        }
        this.send(msg)
      })

      // handle disconnection
      socket.on("disconnect", reason => {
        this.count -= 1
        setStatus(this, this.count)
      })
    })
  }

  RED.nodes.registerType("flexdash in", flexdashIn)
}
