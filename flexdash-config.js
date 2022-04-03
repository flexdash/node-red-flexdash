// FlexDash-config node for Node-RED
// Copyright (c) 2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) {
  const { createServer } = require('http')
  const { Server } = require("socket.io")
  const helpers = require("./fd-helpers.js")(RED)
  const { Store, StoreError } = require("./store.js")
  const Express = require('express')
  const FS = require('fs')
  const glob = require('glob')
  const path = require('path')
  const paths = { // paths to access FlexDash UI files
    prodRoot: path.join(__dirname, '/flexdash'), // production bundle
    prodIndexHtml: path.join(__dirname, '/flexdash/index.html'),
  }

  // configuration node
  class flexdashConfig {
    constructor(config) {
      try { // use try-catch to get stack backtrace of any error

        RED.nodes.createNode(this, config)
        //this.log("FlexDash config: " + JSON.stringify(config))

        this.name = config.name || "FlexDash"
        this.ctxName = config.ctxName || "default"
        this.ctxPrefix = "fd-" + config.id.replace(/\./g, "*") + "-"
        this.saveTimer = null
        this.saveKeys = {}
        this.inputHandlers = {} // key: node.id, value: function(payload) 
        
        this.app = null // express app
        this.devPath = null // path to dev server
        Object.assign(this, this._startWeb(config)) // app, path, io, ioPath, 

        // time to instantiate a store, this is where our local version of the config and the state
        // are cached so they can be sent to newly connecting dashboards.
        // The store is initialized with the stored config, if it's empty the store deals with it...
        this.store = new Store(this._loadConfig(), (...args) => this._sendMutation(...args))
        this.StoreError = StoreError // allows other modules to catch StoreErrors
      } catch (e) { console.error(e.stack); throw e }

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
          
          this.log(`FlexDash recv: ${socket.id} ${topic} ${JSON.stringify(payload).substring(0,20)}`)

          // handle incoming messages for saving config
          if (config.saveConfig) {
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
      for (let f of ["set", "unset", "onInput", "initWidget", "updateWidget",
          "setWidgetParam", "deleteWidgetParam"
      ]) {
        this[f] = helpers[f]
      }
    }

    // ===== internal private methods

    // start all the web services: express and socket.io, returns the socket.io server 'io'
    _startWeb(config) {
      // ensure path starts with a slash and doesn't end with one, "root" ends up as "" not "/"...
      let path = config.path.startsWith("/") ? config.path : "/" + config.path
      while (path.endsWith("/")) path = path.slice(0, -1)
      this.log("path       : " + path)

      // concoct the socket.io options
      let options
      try {
        options = config.ioOpts ? JSON.parse(config.ioOpts) : {}
      } catch (error) {
        this.error(`Cannot parse options JSON: ${error}`)
        options = {}
      }
      if (config.allOrigins) {
        options.cors = {
          origin: true, methods: ["GET", "POST"], credentials: true,
        }
      }
      
      // figure out the mount paths for the express and socket.io servers
      // we end up with something like:
      // /blah/flexdash -> redirect to /blah/flexdash/
      // /blah/flexdash/ -> serve flexdash/index.html with sio=/blah/flexdash/io spliced in
      // /blah/flexdash/io -> socket.io mount point
      // /blah/flexdash/* -> express static server mount point for ./flexdash/*, i.e. UI bundle
      let server, app, ioPath
      if (config.redServer) {
        server = RED.server
        app = RED.httpNode
        // path shenanigans 'cause socket.io gets "mounted" at root while the file serving is
        // relative to httpNodeRoot
        ioPath = RED.settings.httpNodeRoot + path + "/io/"
        ioPath = ioPath.replace(/\/\/+/g, "/")
      } else {
        app = Express()
        server = createServer(app)
        ioPath = path + "/io/"
        server.listen(config.port)
      }
      options.path = ioPath
      this.log("flexdash   : " + paths.prodRoot)
      this.log("socket.io  : " + ioPath)
      this.log("sio options: " + JSON.stringify(options))

      // start/mount servers
      const io = new Server(server, options)
      // handler to serve-up the FlexDash client index.html
      app.get(path, (req, res) => {
        if (!req.path.endsWith('/')) return res.redirect(path+'/')
        FS.readFile(paths.prodIndexHtml, 'utf8', (err, data) => {
          if (err) {
            this.warn(`Cannot read ${paths.prodIndexHtml}: ${err}`)
            return res.status(500).send(`Cannot read index.html`)
          }
          res.send(data.toString().replace(
            '{}', `{sio:window.location.origin+"${ioPath}",title:"${this.name}"}`
          ))
        })
      })
      app.use(path||'/', Express.static(paths.prodRoot, { extensions: ['html'] }))
      // handler to serve up list of extra widgets, as well as extra widgets themselves
      app.get(path+'/xtra.json', async (req, res) => this._xtra(req, res))
      app.get(path+'/xtra/*', (req, res) => {
        this._xtra_lib(req.path.substring(path.length+6), req, res)
      })

      this.log("port       : " + (config.redServer ? "Node-RED port" : ("on port " + port)))
      this.log("FlexDash ready!")
      
      return { app, path, io, ioPath }
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
      // this.io may be null because store gets created before socket.io server...
      if (this.io) this.io.emit("set", topic, value)
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

    // ===== support dynamic loading of external modules
    
    _normalize_xtra(p) {
      const _xtra_re = /\/node_modules\/(([^/]+\/){1,2}widgets\/dist\/[^/]+\.js)$/
      const m = path.normalize(p).match(_xtra_re)
      return m && m[1] ? m[1] : null
    }

    async _xtra(req, res) {
      const dirs = [ process.cwd(), RED.settings.userDir ]
      const response = []
      const prom = new Promise((resolve, reject) => {
        let cnt = 0 // count of oustanding callbacks from glob

        // given an array of paths, create a symlink to each one in the xtraDir
        const linkWidgetDir = (err, paths) => {
          (async (err, paths) => {
            let errs = []
            //console.log(`LWD: ${err} ${paths}`)
            if (err) {
              errs.push(err)
            } else {
              console.log("LWD: " + paths)
              for (let p of paths||[]) {
                p = this._normalize_xtra("./xtra/" + p)
                if (p) response.push(p)
              }
            }
            cnt--
            // if we're done with all outstanding callbacks then resolve/reject the promise
            if (cnt == 0) {
              if (errs.length > 0) reject(new Error(errs.join(', ')))
              else resolve()
            }
          })(err, paths).then(() => {}).catch(e => {
            console.log("Error in linkWidgetDir: " + e.stack)
          })
        }

        for (const dir of dirs) {
          cnt += dirs.length
          glob(`${dir}/node_modules/node-red-fd-*/widgets/dist/fd-widgets.es.js`, linkWidgetDir)
          glob(`${dir}/node_modules/@*/node-red-fd-*/widgets/dist/fd-widgets.es.js`, linkWidgetDir)
        }
      })
      await prom
      res.send(JSON.stringify(response))
    }

    _xtra_lib(url_path, req, res) {
      const file_path = this._normalize_xtra("x/node_modules/" + url_path)
      if (!file_path) {
        this.log("Rejected xtra request for " + url_path)
        return res.status(404).send()
      }
      
      const dirs = [ process.cwd(), RED.settings.userDir ]
      for (const dir of dirs) {
        const p = path.join(dir, "node_modules", file_path)
        if (FS.existsSync(p)) {
          return res.sendFile(p)
        }
      }
      res.status(404).send()
    }
  }

  RED.nodes.registerType("flexdash config", flexdashConfig)
}
