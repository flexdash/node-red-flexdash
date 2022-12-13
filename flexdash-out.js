// FlexDash-out node for Node-RED
// Copyright ©2021 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  function flexdashOut(n) {
    RED.nodes.createNode(this, n)
    this.name = n.name
    this.config_node = RED.nodes.getNode(n.server)

    this.on("input", (msg) => {
      const fdid = msg._fd_socket
      if (fdid) {
        this.config_node.io.in(fdid).emit("msg", msg.topic, msg.payload)
      } else {
        this.config_node.io.emit("msg", msg.topic, msg.payload)
      }
    })
  }

  RED.nodes.registerType("flexdash out", flexdashOut)
}
