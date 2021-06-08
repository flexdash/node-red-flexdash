// FlexDash nodes for Node-RED
// Copyright (c) 2021 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {
  const { Server } = require("socket.io")

  // configuration node
  function flexdashConfig(n) {
    RED.nodes.createNode(this, n)
    this.log("FlexDash config: " + JSON.stringify(n))
    this.port = n.port || 80
    this.redServer = !!n.redServer
    this.saveConfig = !!n.saveConfig
    this.allOrigins = !!n.allOrigins
    this.path = n.path || "/io/flexdash/"
    this.ctxName = n.ctxName || "default"
    this.ctxPrefix = n.ctxPrefix || "flexdash_"

    if (!this.path.startsWith("/")) this.path = "/" + this.path
    if (!this.path.endsWith("/")) this.path = this.path + "/"

    try {
      this.options = n.options ? JSON.parse(n.options) : {}
    } catch (error) {
      this.error(`Cannot parse options JSON: ${error}`)
      this.options = {}
    }

    this.options.path = this.path
    if (this.allOrigins) this.options.cors = {
      origin: "*", methods: ["GET", "POST"], credentials: true,
    }

    this.log("Socket.io options: " + JSON.stringify(this.options))
    if (this.redServer) {
      this.io = new Server(RED.server, this.options)
    } else {
      this.io = new Server(this.options)
      this.io.listen(this.port)
    }

    var bindOn = this.redServer ? "bound to Node-RED port" : "on port " + this.port
    this.log("Created socket.io server " + bindOn)

    this.on("close", ()=> io.close())

    // hook handlers to save FlexDash configuration and send the config back out on start-up
    this.io.on("connection", (socket) => {
      const hs = socket.handshake
      this.log(`Connection ${socket.id} url=${hs.url} x-domain:${hs.xdomain}`)

      // handle incoming messages only for saving config
      if (this.saveConfig) {
        socket.on("msg", (topic, payload) => {
          try {
            if (typeof topic !== 'string') {
              this.warn(`Rx message doesn't have string topic: ${JSON.stringify(topic)}`)
            } else if (topic === "$ctrl" && payload === "start") {
              sendConfig(this, socket)
            } else if (topic.startsWith("$config")) {
              saveConfig(this, socket, topic, payload)
            }
          } catch(err) {
            this.error(`Error storing FlexDash config in context store '${this.ctxName}': ${err}`)
          }
        })
      }

      // handle disconnection
      socket.on("disconnect", reason => {
        this.log(`Disconnected ${socket.id} due to ${reason}`)
      })
    })
  }

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

  function flexdashOut(n) {
    RED.nodes.createNode(this, n)
    this.name = n.name
    this.config_node = RED.nodes.getNode(n.server)

    this.on("input", (msg) => {
      const fdid = msg._flexdash_id
      if (fdid) {
        this.config_node.io.in(fdid).emit("msg", msg.topic, msg.payload)
      } else {
        this.config_node.io.emit("msg", msg.topic, msg.payload)
      }
    })
  }

  function setStatus(node, count) {
    if (count <= 0) node.status({fill:'grey', shape:'ring', text:'no connections'})
    else node.status({fill:'green', shape:'dot', text:`${count} connection${count>1?'s':''}`})
  }

  // send the configuration to a client, the server param is the configuration node
  function sendConfig(server, socket) {
    server.log(`Sending config to ${socket.id} from store ${server.ctxName}`)
    // enumerate all keys with our prefix
    const prefix = server.ctxPrefix
    const keys = server.context().global.keys(server.ctxName).filter(k => k.startsWith(prefix))
    // fetch and send all those keys with their data
    if (keys.length == 0) {
      socket.emit("msg", "$config", {})
      return
    }
    for (let k of keys) {
      const t = k.substring(prefix.length)
      socket.emit("msg", "$config/"+t, server.context().global.get(k, server.ctxName))
    }
  }

  // save the configuration change for a client and propagate it to other clients,
  // the server param is the configuration node
  function saveConfig(server, socket, topic, payload) {
    server.debug(`Saving config of ${topic} for ${socket.id}`)

    const ctx = server.context().global
    const prefix = server.ctxPrefix

    // insert the payload into the saved config, the topic must be either something
    // like $config/widgets or like $config/widgets/w00002
    const t = topic.split('/')
    if (t.length == 2) {
      ctx.set(prefix + t[1], payload, server.ctxName)
    } else if (t.length == 3) {
      // sub-key, need to insert (or delete) data
      let value = ctx.get(prefix + t[1], server.ctxName) || {}
      if (payload === undefined || payload == null) {
        delete value[t[2]]
      } else {
        value[t[2]] = payload
      }
      ctx.set(prefix + t[1], value, server.ctxName)
    }

    // propagate config change to any other connected browser
    socket.broadcast.emit("msg", topic, payload)
  }

  RED.nodes.registerType("flexdash config", flexdashConfig)
  RED.nodes.registerType("flexdash in", flexdashIn)
  RED.nodes.registerType("flexdash out", flexdashOut)
}
