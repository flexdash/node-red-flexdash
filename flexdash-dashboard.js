// FlexDash-config node for Node-RED
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

module.exports = function(RED) { try { // use try-catch to get stack backtrace of any error
  const { createServer } = require('http')
  const { Server } = require("socket.io")
  const { Store, StoreError } = require("./store.js")
  const Express = require('express')
  const FS = require('fs')
  const glob = require('glob')
  const path = require('path')
  const paths = { // paths to access FlexDash UI files
    prodRoot: path.join(__dirname, '/flexdash'), // production bundle
    prodIndexHtml: path.join(__dirname, '/flexdash/index.html'),
  }
  const flowPersistence = RED.plugins.get('flexdash')._flowPersistence

  RED.events.on("flows:stopping", info => {
    RED.log.info(`flows:stopping ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
  })

  RED.events.on("flows:started", info => {
    RED.log.info(`flows:started ${info.type} diff: ${JSON.stringify(info.diff||{})}`)
  })

  // Flow of configuration change messages and calls
  //
  // There are three sources of config changes: the NR flow editor, a FD dashboard, and NR messages.
  //
  // NR flow editor changes occur in the form of a deployment of a flow, which causes nodes to be
  // recreated, which causes calls to "initWidget", etc., which turn into "addWidget" operations
  // on the store, that create "mutations" that are applied to the store and passed to the Store's
  // emit callback. That lands in _sendMutation in FlexDashDashboard, which uses socket.io to
  // broadcast to all connected dashboards.
  //
  // FD dashboard changes occur in the form of set $config/xxx messages coming in, which are
  // applied to the store and queued for flow editors by _recvConfig in FlexDashDashboard.
  // Flow editors then ajax query the set of queued changes and apply them to the affected nodes,
  // which can then be "deploy"-ed. When a node is re-created by such a deploy the changes that
  // were queued for it are deleted.
  //
  // Some NR messages may also cause alterations to the config. It is generally a good idea to
  // design things so that doesn't happen. How these effects flow is unclear at this point...


  // ===== FlexDash Dashboard configuration node
  class FlexDashDashboard {
    constructor(config) {
      try { // use try-catch to get stack backtrace of any error
        RED.nodes.createNode(this, config)
        //this.log("FlexDash config: " + JSON.stringify(config))

        this.name = config.name || "FlexDash"
        this.inputHandlers = {} // input from widgets; key: node.id, value: function(payload)

        // start the web servers!
        this.app = null // express app
        this.devPath = null // path to dev server (generated here)
        Object.assign(this, this._startWeb(config)) // app, path, io, ioPath, 

        // time to instantiate a store, this is where our local version of the config and the state
        // are cached so they can be sent to newly connecting dashboards.
        // The store is initialized with the our config
        let tabs
        try { tabs = JSON.parse(config.tabs) }
        catch (e) { tabs = {} }
        const store_config = {
          dash: { title: this.name, tabs: Object.keys(tabs) },
          tabs, grids: {}, widgets: {},
        }
        this.store = new Store(store_config,
            (...args) => this._sendMutation(...args)) // send to connected dashboards
        this.StoreError = StoreError // allows other modules to catch StoreErrors
      } catch (e) { console.error(e.stack); throw e }

      this.on("close", () => io.close())

      // hook handlers to save FlexDash configuration and send the config back out on start-up
      this.io.on("connection", (socket) => {
        const hs = socket.handshake
        this.log(`FlexDash connection ${socket.id} url=${hs.url} x-domain:${hs.xdomain}`)

        // send initial state
        if (config.saveConfig) this._sendConfig(socket)
        this._sendData(socket)

        socket.on("msg", (topic, payload) => {
          if (typeof topic !== 'string') {
            this.warn(`Rx message doesn't have string topic: ${JSON.stringify(topic)}`)
            return
          }
          
          this.log(`FlexDash recv: ${socket.id} ${topic} ${JSON.stringify(payload).substring(0,20)}`)

          // handle incoming messages for saving config
          if (config.saveConfig && topic.startsWith("$config")) {
            try {
              this._recvConfig(socket, topic, payload)
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
    }

    // ===== public methods called by other internal nodes, such as flexdash container and tab

    initTab(tab) {
      flowPersistence.register(this.id, tab.config.fd_id, tab.id)
      const c = tab.config
      if (!c.fd_id || !c.fd_id.startsWith('t')) throw new Error(`bad tab ID: ${c.fd_id}`)
      const fd_config = { id: c.fd_id, title: c.name, icon: c.icon, pos: c.fd_pos }
      this.store.addTab('grid', fd_config)
    }

    destroyTab(tab) {
      flowPersistence.unregister(this.id, tab.config.fd_id)
      this.store.deleteTab(tab.config.fd_id)
    }

    initGrid(grid) {
      flowPersistence.register(this.id, grid.config.fd_id, grid.id)
      const c = grid.config
      if (!c.fd_id || !c.fd_id.startsWith('g')) throw new Error(`bad grid ID: ${c.fd_id}`)
      const tab = RED.nodes.getNode(c.tab)
      const fd_config = {
        id: c.fd_id, kind: 'FixedGrid', title: c.name,
        pos: c.fd_pos, min_cols: c.min_cols, max_cols: c.max_cols,
      }
      this.store.addGrid(tab.config.fd_id, fd_config)
    }

    destroyGrid(grid) {
      flowPersistence.unregister(this.id, grid.config.fd_id)
      this.store.deleteGrid(grid.config.fd_id)
    }

    initPanel(panel) {
      flowPersistence.register(this.id, panel.config.fd_id, panel.id)
      const c = panel.config
      if (!c.fd_id || !c.fd_id.startsWith('w')) throw new Error(`bad panel ID: ${c.fd_id}`)
      const grid = RED.nodes.getNode(c.parent)
      const fd_config = {
        id: c.fd_id, kind: 'Panel', title: c.name,
        pos: c.fd_pos, rows: c.rows, cols: c.cols,
        dyn_root: "node-red/" + c.id,
        static: { solid: c.solid, widgets: [] },
      }
      this.store.addWidget(grid.config.fd_id, fd_config)
    }

    destroyPanel(panel) {
      flowPersistence.unregister(this.id, panel.config.fd_id)
      this.store.deleteWidget(panel.config.fd_id)
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

    // send the data state to a client
    // internal-only
    _sendData(socket) {
      // enumerate all keys with our prefix
      const keys = Object.keys(this.store.sd)
      this.log(`Sending initial data to ${socket.id} from store ${this.ctxName} with ${keys.length} keys`)
      socket.emit("set", "sd", this.store.sd)
    }

    // receive a configuration change from a client (dashboard), apply it to the store, propagate
    // it to other clients, and finally queue it for the flow editor to persist
    // internal-only
    _recvConfig(socket, topic, payload) { // topic has leading $config
      this.debug(`Saving config of ${topic} for ${socket.id}`)
      // insert the payload into the store's config portion
      this.store.set(topic, payload)
      // propagate config change to any other connected browser
      socket.broadcast.emit("set", topic, payload)
      // persist the config change: grab the data for that from the store: we send full
      // objects (e,.g. a grid, a widget) as opposed to just some fields
      let tt = topic.split('/')
      if (tt.length < 2 || tt[0] != '$config') throw new Error("invalid topic: " + topic)
      tt.shift() // remove leading $config
      let kind = tt[0] // 'dash', 'tabs', 'grids', or 'widgets'
      const config = kind == 'dash' ? this.store.config.dash : this.store.config[kind][tt[1]]
      flowPersistence.saveMutation(this.id, kind, tt[1], config)
    }

    // send an internally generated mutation to all connected dashboards
    // internal only
    _sendMutation(topic, value) { // topic has leading $config/
      // this.io may be null because store gets created before socket.io server...
      if (this.io) this.io.emit("set", topic, value)
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

        this.log("Looking for extra widgets in " + dirs.join(', '))
        for (const dir of dirs) {
          cnt += 2
          glob(`${dir}/node_modules/node-red-fd-*/widgets/dist/fd-widgets.es.js`, linkWidgetDir)
          glob(`${dir}/node_modules/@*/node-red-fd-*/widgets/dist/fd-widgets.es.js`, linkWidgetDir)
        }
      })
      await prom
      this.log("Extra widget modules: " + response.join(', '))
      res.send(JSON.stringify(response))
    }

    // handle HTTP request to fetch an extra-widgets library file
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

  RED.nodes.registerType("flexdash dashboard", FlexDashDashboard)
} catch(e) { console.log(`Error in ${__filename}: ${e.stack}`) }
}
