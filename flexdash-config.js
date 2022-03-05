// FlexDash-config node for Node-RED
// Copyright (c) 2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {
  const { createServer } = require('http')
  const { Server } = require("socket.io")
  const helpers = require("./fd-helpers.js")(RED)
  const { Store, StoreError } = require("./store.js")
  const Express = require('express')
  const FS = require('fs')
  const startPage = FS.readFileSync(__dirname + '/dist/index.html', 'utf8')

  // configuration node
  class flexdashConfig {
    constructor(n) {
      RED.nodes.createNode(this, n)
      //this.log("FlexDash config: " + JSON.stringify(n))
      this.port = n.port || 80
      this.redServer = !!n.redServer
      this.saveConfig = !!n.saveConfig
      this.allOrigins = !!n.allOrigins
      this.path = n.path || "/flexdash"
      this.ctxName = n.ctxName || "default"
      this.ctxPrefix = "fd-" + n.id.replace(/\./g, "*") + "-"
      this.saveTimer = null
      this.saveKeys = {}
      this.inputHandlers = {} // key: node.id, value: function(payload) 

      // ensure path starts with a slash and doesn't end with one, "root" is "" not "/"...
      if (!this.path.startsWith("/")) this.path = "/" + this.path
      while (this.path.endsWith("/")) this.path = this.path.slice(0, -1)

      // concoct the socket.io options
      try {
        this.options = n.options ? JSON.parse(n.options) : {}
      } catch (error) {
        this.error(`Cannot parse options JSON: ${error}`)
        this.options = {}
      }
      if (this.allOrigins) {
        this.options.cors = {
          origin: true, methods: ["GET", "POST"], credentials: true,
        }
      }
      
      // start the socket.io server as well as serve-up the FlexDash client static files
      let server, app, fullPath
      if (this.redServer) {
        server = RED.server
        app = RED.httpNode
        // path shenanigans 'cause socket.io gets "mounted" at root while the file serving is
        // relative to httpNodeRoot
        fullPath = RED.settings.httpNodeRoot + this.path + "/io/"
        fullPath = fullPath.replace(/\/\/+/g, "/")
      } else {
        app = Express()
        server = createServer(app)
        fullPath = this.path + "/io/"
        server.listen(this.port)
      }
      this.options.path = fullPath
      this.io = new Server(server, this.options)
      // handler to serve-up the FlexDash client
      this.startPage = startPage.replace('{}', `{sio:window.location.origin+"${fullPath}"}`)
      app.get(this.path, (req, res) => {
        this.log('Got ' + req.path)
        req.path.endsWith('/') ? res.send(this.startPage) : res.redirect(this.path+'/')
      })
      app.use(this.path||'/', Express.static(__dirname+'/dist', { extensions: ['html'] }))

      var bindOn = this.redServer ? "bound to Node-RED port" : "on port " + this.port
      this.log("FlexDash started socket.io server " + bindOn +
          " with options " + JSON.stringify(this.options))

      // time to instatiate a store, this is where our local version of the config and the state
      // are cached so they can be sent to newly connecting dashboards.
      // The store is initialized with the stored config, if it's empty the store deals with it...
      try { // use try-catch to get stack backtrace of any error
        this.store = new Store(this._loadConfig(), (...args) => this._sendMutation(...args))
      } catch (e) { console.warn(e.stack); throw e }
      this.StoreError = StoreError // allows other modules to catch StoreErrors

      this.on("close", () => io.close())

      // hook handlers to save FlexDash configuration and send the config back out on start-up
      this.io.on("connection", (socket) => {
        const hs = socket.handshake
        this.log(`FlexDash connection ${socket.id} url=${hs.url} x-domain:${hs.xdomain}`)

        socket.on("msg", (topic, payload) => {
          if (typeof topic !== 'string') {
            this.warn(`Rx message doesn't have string topic: ${JSON.stringify(topic)}`)
            return
          }

          // handle incoming messages for saving config
          if (this.saveConfig) {
            try {
              if (topic === "$ctrl" && payload === "start") {
                this._sendConfig(socket)
              } else if (topic.startsWith("$config")) {
                this._recvConfig(socket, topic, payload)
              }
            } catch (err) {
              this.error(`Error storing FlexDash config in context store '${this.ctxName}': ${err.stack}`)
            }
          }

          // handle incoming messages to forward to nodes
          if (topic.startsWith("nr/")) {
            const id = topic.substring(3)
            if (id in this.inputHandlers) {
              this.inputHandlers[id].call({}, payload)
            }
          }
        })

        // handle disconnection
        socket.on("disconnect", reason => {
          this.log(`FlexDash disconnect ${socket.id} due to ${reason}`)
        })
      })

      // ===== public helper methods on the config object
      // export helper functions as methods so they can be reached from fd nodes
      for (let f of ["onInput", "initWidget", "updateWidget"]) {
        this[f] = helpers[f]
      }
    }

    // ===== internal private methods

    _serveRoot(req, res) {
      res.send(this.startPage)
    }

    // send the configuration to a client, the server param is the configuration node
    // internal-only
    _sendConfig(socket) {
      // enumerate all keys with our prefix
      const keys = Object.keys(this.store.config)
      if (keys.length == 0) {
        this.log(`Sending empty config to ${socket.id} from store ${this.ctxName}`)
        socket.emit("set", "$config", {}) // the dashboard deals with init'ing a minimal config
      } else {
        this.log(`Sending config to ${socket.id} from store ${this.ctxName} including ${keys.join(', ')}`)
        for (let k of keys) {
          socket.emit("set", "$config/" + k, this.store.config[k])
        }
      }
    }

    // receive a configuration change for a client, save it, and propagate it to other clients
    // internal-only
    _recvConfig(socket, topic, payload) {
      this.debug(`Saving config of ${topic} for ${socket.id}`)
      // insert the payload into the store's config portion
      this.store.set(topic, payload)
      // propagate config change to any other connected browser
      socket.broadcast.emit("set", topic, payload)
      // persist the config change
      const t = topic.split('/')
      if (t.length > 1) {
        this._saveConfigSoon(t[1])
      } else {
        this.warn("Cannot persist entire config") // the dashboard should never attempt that
      }
    }

    // internal only
    _sendMutation(what, topic, value) {
      this._saveConfigSoon(what)
      this.io.emit("set", topic, value)
    }

    // save the config in a few milliseconds, such that a slew of config changes only result in
    // one save
    // internal-only
    _saveConfigSoon(what) {
      this.saveKeys[what] = true
      if (!this.saveTimer) {
        this.saveTimer = setTimeout(() => {
          this.saveTimer = null
          this._saveConfigNow()
        }, 500)
      }
    }

    // save the config to a context store
    // internal-only
    _saveConfigNow() {
      const ctx = this.context().global
      for (const k in this.saveKeys) {
        ctx.set(this.ctxPrefix + k, this.store.config[k], this.ctxName)
        delete this.saveKeys[k]
      }
    }

    // load the dashboard configuration from the global context store and return it
    // internal-only
    _loadConfig() {
      const ctx = this.context().global
      // enumerate all keys with our prefix
      const keys = ctx.keys(this.ctxName).filter(k => k.startsWith(this.ctxPrefix))
      const config = Object.fromEntries(keys.map(k =>
        [k.substring(this.ctxPrefix.length), ctx.get(k, this.ctxName)]
      ))
      return config
    }

  }

  RED.nodes.registerType("flexdash config", flexdashConfig)
}
