// FlexDash-in node for Node-RED
// Copyright ©2021 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {

  function setStatus(node, count) {
    if (count <= 0) node.status({fill:'grey', shape:'ring', text:'no connections'})
    else node.status({fill:'green', shape:'dot', text:`${count} connection${count>1?'s':''}`})
  }
  
  // flexdash-in node, receives messages from dashboards
  function flexdashIn(n) {
    RED.nodes.createNode(this, n)
    this.name = n.name
    this.config_node = RED.nodes.getNode(n.server)
    this.count = 0
    if (!this.config_node) return
    

    this.config_node.io.on("connection", (socket) => {
      this.count += 1
      setStatus(this, this.count)
      
      // handle incoming messages
      socket.on('msg', (topic, payload) => {
        const msg = {
          topic       : topic || "",
          payload     : payload || null,
          _fd_socket  : socket.id,
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
