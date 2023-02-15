// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function (RED) {
  try {
    // use try-catch to get stack backtrace of any error
    const { createServer } = require("http")
    const { Server } = require("socket.io")
    const Express = require("express")
    const CookieSession = require("cookie-session")
    const FS = require("fs")
    const glob = require("glob")
    const path = require("path")
    const url = require("url")
    const crypto = require("crypto")
    const { Store, StoreError } = require("./store.js")
    const paths = {
      // paths to access FlexDash UI files
      prodRoot: path.join(__dirname, "flexdash"), // production bundle
      prodIndexHtml: path.join(__dirname, "flexdash", "index.html"),
    }
    //const plugin = RED.plugins.get("flexdash")
    const version = require(path.join(__dirname, "package.json")).version

    // hack... the corewidgets repo doesn't have any static js file where this could be placed
    let cw_version
    try {
      cw_version = require(path.join(
        __dirname,
        "..",
        "node-red-fd-corewidgets",
        "package.json"
      )).version
    } catch (e) {}

    // ===== Websocket upgrade handlers

    // Express has the problem that it is not possible to unmount anything. This makes it tricky to
    // restart a Socket.io server instance, because the latter registers an upgrade handler for the
    // websocket. If we delete a socket.io instance and create a new one, the old one really never
    // goes away including its upgrade handler. If we then start a new instance, its upgrade handler
    // goes into the handler chain *after* the original one and if the two instances' paths are the
    // same, the old one will get all the upgrade requests and reject them.
    // The solution is to handle upgrades ourselves in a handler that gets mounted before any
    // by socket.io.

    const sio_servers = {} // map of socket.io servers by path

    function sioUpgradeHandler(req, socket, head) {
      const path = url.parse(req.url).pathname
      RED.log.info(`Upgrade request for ${path} got ${Object.keys(sio_servers).join(",")}`)
      if (path in sio_servers) {
        const sio = sio_servers[path]
        if (sio) {
          sio.engine.handleUpgrade(req, socket, head)
          req.url = "xxxxx" // prevent socket.io from handling this request
        } else {
          // we used to have a server, but it was closed, so we close the socket to ensure nothing happens
          socket.destroy()
        }
      }
    }
    RED.server.on("upgrade", sioUpgradeHandler)

    function sioRegister(path, sio) {
      sio_servers[path] = sio
    }
    function sioUnregister(path) {
      sio_servers[path] = null // null means closed, i.e., reject requests
    }

    // ===== FlexDash Dashboard configuration node
    class FlexDashDashboard {
      constructor(config) {
        try {
          // use try-catch to get stack backtrace of any error
          RED.nodes.createNode(this, config)
          //this.log("FlexDash config: " + JSON.stringify(config))

          this.name = config.name || "FlexDash"
          this.inputHandlers = {} // input from widgets; key: node.id, value: function(payload)
          this.ctrlHandlers = [] // flexdash ctrl nodes: {node,handler}
          this.config = config
          this.plugin = RED.plugins.get("flexdash")
          this.regs = {} // component registry for custom widgets and components
          this.clients = {} // map of connected client IDs to { socket, browser }

          // Instantiate a store, this is where our local version of the config and the state
          // are cached so they can be sent to newly connecting dashboards.
          // The store is initialized with our config
          const store_config = {
            dash: { title: this.name, tabs: [] },
            tabs: {},
            grids: {},
            widgets: {},
          }
          this.store = new Store(store_config, (...args) => this._sendMutation(...args)) // send to connected dashboards
          this.store.do_queue = true
          this.StoreError = StoreError // "export" to allow other modules to catch StoreErrors
          this.plugin._newNode(this.id, this, {})

          // start the web servers!
          this.app = null // express app
          this.devPath = null // path to dev server (generated here)
          Object.assign(this, this._startWeb(config)) // app, path, io, ioPath,
        } catch (e) {
          console.error(e.stack)
          throw e
        }

        this.on("close", () => {
          try {
            this.plugin._delNode(this.id)
            this._stopWeb()
          } catch (e) {
            console.error(e.stack)
          }
        })

        // hook handlers to save FlexDash configuration and send the config back out on start-up
        this.io.on("connection", socket => {
          const hs = socket.handshake
          const connID = hs.headers && hs.headers["x-client-id"]
          const browserID = socket.request?.session?.id
          //const browserID = socket.request.session
          this.log(
            `FlexDash connection ${socket.id} conn=${connID} session=${browserID} url=${hs.url} x-domain:${hs.xdomain}`
          )
          if (typeof connID !== "string" || connID.length != 16) {
            this.warn(`Missing or invalid client (connection) ID: ${connID}`)
            socket.disconnect()
            return
          }
          if (typeof browserID !== "string" || browserID.length != 24) {
            this.warn(`Missing or invalid session (browser) ID: ${browserID}`)
            socket.disconnect()
            return
          }

          if (connID in this.clients) {
            // reconnecting client, cancel idle timer
            if (this.clients[connID].idle) clearTimeout(this.clients[connID].idle)
            this.clients[connID].idle = null
          } else {
            // new client, send initial state
            if (config.saveConfig) this._sendConfig(socket)
            this._sendData(socket)
            // manufacture an event to signal that a new client has connected
            this._recvEvent(connID, "dashboard", { type: "new client", browser: browserID })
          }
          this.clients[connID] = { socket: socket.id, browser: browserID, idle: null }

          socket.on("msg", (topic, payload) => {
            if (typeof topic !== "string") {
              this.warn(`Rx message doesn't have string topic: ${JSON.stringify(topic)}`)
              return
            }

            //this.log(`FlexDash recv: ${socket.id} ${topic} ${JSON.stringify(payload).substring(0,20)}`)

            // handle incoming messages for saving config
            if (config.saveConfig && topic.startsWith("$config")) {
              this.error("Saving config is not supported in this version of Node-RED-FlexDash")
            }

            // handle incoming messages to forward to nodes
            if (topic.startsWith("nr/")) {
              try {
                this._recvData(connID, topic.substring(3), payload)
              } catch (err) {
                this.error(`Error handling data message:\n${err.stack}`)
              }
            }
          })

          socket.on("event", (target, payload) => {
            this._recvEvent(connID, target, payload)
          })

          // handle disconnection
          socket.on("disconnect", reason => {
            this.log(`FlexDash disconnect ${socket.id} conn=${connID} due to ${reason}`)
            if (this.clients[connID].socket == socket.id) {
              // timeout, set timer to send a client-idle event
              console.log("set timeout")
              setTimeout(() => {
                console.log("Socket timeout", socket.id, connID)
                if (this.clients[connID].socket == socket.id) {
                  delete this.clients[connID]
                  this._recvEvent(connID, "dashboard", { type: "idle client" })
                }
              }, 10000)
            }
          })
        })
      }

      // addWidget registers a custom widget script code so it can be served to
      // the browser. Returns the URL for the script.
      // This is also used to register custom components, not just widgets.
      addWidget(name, content) {
        this.regs[name] = content
        return `${this.path}/custom/${name}`
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
            origin: true,
            methods: ["GET", "POST"],
            credentials: true,
          }
        }

        // figure out the mount paths for the express and socket.io servers
        // we end up with something like:
        // /blah/flexdash -> redirect to /blah/flexdash/
        // /blah/flexdash/ -> serve flexdash/index.html with sio=/blah/flexdash/io spliced in
        // /blah/flexdash/io -> socket.io mount point
        // /blah/flexdash/* -> express static server mount point for ./flexdash/*, i.e. UI bundle
        let server, rootApp, ioPath
        if (config.redServer) {
          server = RED.server
          rootApp = RED.httpNode
          // path shenanigans 'cause socket.io gets "mounted" at root while the file serving is
          // relative to httpNodeRoot
          ioPath = RED.settings.httpNodeRoot + path + "/io/"
          ioPath = ioPath.replace(/\/\/+/g, "/")
        } else {
          rootApp = Express()
          server = createServer(rootApp)
          ioPath = path + "/io/"
          server.listen(config.port)
        }
        options.path = ioPath
        this.log("flexdash   : " + paths.prodRoot)
        this.log("socket.io  : " + ioPath)
        this.log("sio options: " + JSON.stringify(options))

        // start/mount servers
        const io = new Server(server, options)
        if (config.redServer) sioRegister(ioPath, io)
        // handler to serve-up the FlexDash client index.html
        const app = Express()
        app.locals.name = "FlexDash"
        rootApp.use(path, app)
        rootApp._router.stack[rootApp._router.stack.length - 1].node_id = this.id // ID for removal later

        // cookie middleware
        this.cookieSession = CookieSession({
          name: "flexdash" + encodeURIComponent(ioPath.replace(/\//g, "-").replace(/-$/, "")),
          secret: crypto.randomBytes(32).toString("hex"),
          //secret:  "it's me dude",
          maxAge: 7 * 24 * 3600 * 1000, // inactivity timeout
          path,
          //secure: 'auto',
          // need sameSite=none to develop using https
          //sameSite: 'none', // may be a problem with 3rd party cookie blocking
          sameSite: "strict", // strict needed for HTTP to work
        })
        // insert cookie middleware in express, extend validity periodically
        app.use(this.cookieSession)
        app.use((req, res, next) => {
          //console.log("HTTP:", req.session)
          req.session.now = Math.floor(Date.now() / 3600e3) // extend validity
          if (!req.session.id) req.session.id = crypto.randomBytes(16).toString("base64")
          next()
        })
        // insert cookie "middleware" in socket.io
        // we can't use a socket.io middleware (io.use) because it can't set response headers
        // so we have to use the engine's headers event and fake out a response object to
        // capture any header set by the cookie-session. fun stuff...
        io.engine.on("headers", (headers, request) => {
          // fake response object to capture cookie header
          const res = {
            getHeader() {},
            setHeader(k, v) {
              headers[k] = v
            }, // capture header and set it in the engine
            writeHead() {}, // calling this triggers cookie-session to call setHeader
          }
          this.cookieSession(request, res, () => {}) // sets request.session
          //console.log("IO:", request.session)
          request.session.now = Math.floor(Date.now() / 3600e3) // extend validity
          if (!request.session.id) request.session.id = crypto.randomBytes(16).toString("base64")
          res.writeHead() // trigger setting of header (if necessary)
        })

        // path-based handlers
        app.get("/", (req, res) => {
          const path = url.parse(req.originalUrl).pathname
          if (!path.endsWith("/")) return res.redirect(path + "/")
          FS.readFile(paths.prodIndexHtml, "utf8", (err, data) => {
            if (err) {
              this.warn(`Cannot read ${paths.prodIndexHtml}: ${err}`)
              return res.status(500).send(`Cannot read index.html`)
            }
            let flexdash_options = JSON.stringify({
              sio: `window.location.origin+'${ioPath}'`,
              title: this.name,
              no_add_delete: true,
              no_demo: true,
              edit_disabled: true,
            }).replace(/"(w[^"]*)"/, "$1")
            res.send(data.toString().replace("{}", flexdash_options))
          })
        })
        app.use("/", Express.static(paths.prodRoot, { extensions: ["html"] }))
        // handler to serve up list of extra widgets, as well as extra widgets themselves
        app.get("/xtra.json", async (req, res) => this._xtra(req, res))
        app.get("/xtra/*", (req, res) => {
          console.log("xtra: " + req.path)
          this._xtra_lib(req.path.substring(6), req, res)
        })
        // handler to serve up custom widget script code
        app.use("/custom/:name", (req, res) => {
          if (this.regs[req.params.name]) {
            res.set("Content-Type", "application/javascript")
            res.send(this.regs[req.params.name])
          } else {
            res.status(404).send(`No such widget: ${req.params.name}`)
          }
        })

        this.log("port       : " + (config.redServer ? "Node-RED port" : "on port " + config.port))
        this.log("FlexDash ready!")

        return { app, rootApp, path, io, ioPath }
      }

      _stopWeb() {
        this.io.disconnectSockets()
        if (this.config.redServer) {
          // hacky stuff required 'cause Express doesn't allow unmounting anything...
          sioUnregister(this.ioPath)
          //this.io.close(() => console.log("SIO closed")) // kills http server!?\!
          RED.httpNode._router.stack.forEach((route, i, routes) => {
            if (route.node_id == this.id) {
              RED.log.info("Removing route: " + route.regexp)
              routes.splice(i, 1)
            }
          })
        } else {
          this.io.close(() => console.log("SIO closed")) // kills http server!
        }
      }

      // send the configuration to a client, the server param is the configuration node
      // internal-only
      _sendConfig(socket) {
        // enumerate all keys with our prefix
        const keys = Object.keys(this.store.config)
        if (keys.length == 0) {
          this.log(`Sending empty config to ${socket.id}`)
          socket.emit("set", "$config", {}) // the dashboard deals with init'ing a minimal config
        } else {
          this.log(`Sending config to ${socket.id} including ${keys.join(", ")}`)
          for (let k of keys) {
            // console.log(`CONFIG: ${k}`)
            // for (const kk in this.store.config[k]) {
            //   if (this.store.config[k][kk].kind == "Panel")
            //     console.log(`  ${kk}: ${JSON.stringify(this.store.config[k][kk])}`)
            // }

            socket.emit("set", "$config/" + k, this.store.config[k])
          }
          socket.emit("set", "$config/ready", true)
        }
      }

      // send the data state to a client
      // internal-only
      _sendData(socket) {
        //this.log(`Sending initial data to ${socket.id} with ${keys.length} keys`)
        socket.emit("set", "sd", this.store.sd)
      }

      // receive a configuration change from a client (dashboard), apply it to the store, propagate
      // it to other clients, and finally queue it for the flow editor to persist
      // internal-only
      // _recvConfig(socket, topic, payload) {
      //   // topic has leading $config
      //   this.log(`Saving config of ${topic} for ${socket.id} ${JSON.stringify(payload)}`)
      //   // insert the payload into the store's config portion
      //   this.store.set(topic, payload)
      //   // propagate config change to any other connected browser
      //   socket.broadcast.emit("set", topic, payload)
      //   // persist the config change: grab the data for that from the store: we send full
      //   // objects (e,.g. a grid, a widget) as opposed to just some fields
      //   let tt = topic.split("/")
      //   if (tt.length < 2 || tt[0] != "$config") throw new Error("invalid topic: " + topic)
      //   tt.shift() // remove leading $config
      //   let kind = tt[0] // 'dash', 'tabs', 'grids', or 'widgets'
      //   const config = kind == "dash" ? this.store.config.dash : this.store.config[kind][tt[1]]
      //   plugin._saveMutation(this.id, kind, tt[1], config)
      // }

      // receive a data message from dashboard and forward to appropriate node
      _recvData(connID, topic, payload) {
        //console.log("inputHandlers:", Object.keys(this.inputHandlers).join(' '))
        // handle array-widgets
        const ix = topic.indexOf("|")
        const array_topic = ix > 0 ? topic.substring(ix + 1) : undefined
        if (ix > 0) topic = topic.substring(0, ix)
        // find node and send it the message
        if (topic in this.inputHandlers) {
          try {
            this.inputHandlers[topic].call({}, array_topic, payload, connID)
          } catch (e) {
            this.warn(`Error handling input for ${topic}: ${e}`)
          }
        } else this.log(`No input handler for ${topic}`) // else silently swallow !?
      }

      // receive an event from dashboard signifying a state change (e.g. change tab)
      _recvEvent(connID, target, payload) {
        // augemnt the message with node-red specific info
        if (payload.id) {
          const nr_id = payload.id.substring(1) // remove leading t/g
          const node = RED.nodes.getNode(nr_id)
          if (node) {
            payload.node_id = nr_id
            payload.name = node.name || node.config?.name
            payload.title = node.title || node.config?.title
          } else {
            this.warn(`No node found for ${payload.id}`)
          }
          delete payload.id
        }
        console.log(`Event ${connID} ${target} ${JSON.stringify(payload)}`)
        // send message to all ctrl nodes
        for (const h of this.ctrlHandlers) {
          try {
            h.handler?.call({}, null, payload, connID) // null topic for now
          } catch (e) {
            this.warn(`Error handling ctrl event for ${topic}: ${e}`)
          }
        }
      }

      // send an internally generated mutation to all connected dashboards
      // internal only
      _sendMutation(topic, value) {
        // topic has leading $config/
        // this.io may be null because store gets created before socket.io server...
        //if (this.io) console.log(`Sending mutation ${topic}`)
        if (this.io) this.io.emit("set", topic, value)
      }

      // send a message to one or all clients
      _send(kind, topic, payload, connID) {
        if (!this.io) return // no socket.io server
        if (connID) {
          if (connID in this.clients) {
            this.io.to(this.clients[connID].socket).emit(kind, topic, payload)
          } else {
            this.log(`Conn ${connID} is disconnected`)
          }
        } else this.io.emit(kind, topic, payload)
      }

      // ===== support dynamic loading of external modules

      _normalize_xtra(p) {
        const _xtra_re = /\/node_modules\/(([^/]+\/){1,2}widgets\/dist\/[^/]+\.js)$/
        //const m = path.normalize(p).match(_xtra_re) // normalize converts to \ on windows
        const m = p.match(_xtra_re)
        return m && m[1] ? m[1] : null
      }

      async _xtra(req, res) {
        const dirs = [process.cwd(), RED.settings.userDir]
        const response = []
        const prom = new Promise((resolve, reject) => {
          let cnt = 0 // count of oustanding callbacks from glob

          // given an array of paths, create a symlink to each one in the xtraDir
          const linkWidgetDir = (err, paths) => {
            ;(async (err, paths) => {
              let errs = []
              //console.log(`LWD: ${err} ${paths}`)
              if (err) {
                errs.push(err)
              } else {
                for (let p of paths || []) {
                  p = this._normalize_xtra("./xtra/" + p)
                  if (p) response.push(p)
                }
              }
              cnt--
              // if we're done with all outstanding callbacks then resolve/reject the promise
              if (cnt == 0) {
                if (errs.length > 0) reject(new Error(errs.join(", ")))
                else resolve()
              }
            })(err, paths)
              .then(() => {})
              .catch(e => {
                RED.log.warn("Error in linkWidgetDir: " + e.stack)
              })
          }

          this.log("Looking for extra widgets in " + dirs.join(", "))
          for (const dir of dirs) {
            cnt += 2
            glob(`${dir}/node_modules/node-red-fd-*/widgets/dist/fd-widgets.es.js`, linkWidgetDir)
            glob(
              `${dir}/node_modules/@*/node-red-fd-*/widgets/dist/fd-widgets.es.js`,
              linkWidgetDir
            )
          }
        })
        await prom
        this.log("Extra widget modules: " + response.join(", "))
        res.send(JSON.stringify(response))
      }

      // handle HTTP request to fetch an extra-widgets library file
      _xtra_lib(url_path, req, res) {
        let file_path = this._normalize_xtra("x/node_modules/" + url_path)
        if (!file_path) {
          this.log("Rejected xtra request for " + url_path)
          return res.status(404).send()
        }
        file_path = path.normalize(file_path) // also converts to \ on windows

        const dirs = [process.cwd(), RED.settings.userDir]
        for (const dir of dirs) {
          const d = path.join(dir, "node_modules")
          if (FS.existsSync(path.join(d, file_path))) {
            return res.sendFile(file_path, { root: d }) // root option helps windows
          }
        }
        res.status(404).send()
      }
    }

    RED.nodes.registerType("flexdash dashboard", FlexDashDashboard)
    RED.plugins.get("node-red-vue").createVueTemplate("flexdash dashboard", __filename)
    RED.log.info("Node-RED FlexDash version " + version)
    FS.readFile(paths.prodRoot + "/VERSION", "utf8", (err, data) => {
      if (err) RED.log.info("Trying to print FD version: " + err)
      else if (data) RED.log.info(`FlexDash UI version ${data}`)
    })
    if (cw_version) RED.log.info("Node-RED FD Core Widgets version " + cw_version)
  } catch (e) {
    console.log(`Error in ${__filename}: ${e.stack}`)
  }
}
