// FlexDash Development Server
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

const fs = require("fs")
const http = require("http")
const path = require("path")
const cp = require("child_process")
const glob = require("glob")
const tar = require("tar")
const { createProxyMiddleware } = require("http-proxy-middleware")
const util = require("util")
const exec = util.promisify(require("child_process").exec)
const execFile = util.promisify(require("child_process").execFile)

// ViteDevServer is a singleton class that manages a Vite development server process. The reason to
// a singleton is that the proxy modifies files on disk, which becomes a mess if multiple proxies are
// active. Also the websock proxy is effectively mounted at the root and so multiple ones are
// difficult to multiplex.
class ViteDevServer {
  constructor(RED, install) {
    this.install = install
    this.userDir = RED.settings.userDir
    this.sourceDir = path.join(this.userDir, "flexdash-src")
    this.viteBin = path.join(this.sourceDir, "node_modules", "vite", "bin", "vite.js")
    this.vite = this.vitePort = this.viteReady = this.viteProxy = null
    this.dev_node = null
  }

  // show a node status dot and message, err is optional
  showStatus(err) {
    if (!this.dev_node) return
    if (err && err != "OK") {
      this.dev_node.status({ fill: "red", shape: "dot", text: err })
    } else if (this.vite && this.viteReady) {
      this.dev_node.status({ fill: "green", shape: "dot", text: "running" })
    } else if (this.vite && !this.viteReady) {
      this.dev_node.status({ fill: "yellow", shape: "dot", text: "starting" })
    } else if (!err && (err = this.checkSetup()) != "OK") {
      this.dev_node.status({ fill: "red", shape: "dot", text: err })
    } else {
      this.dev_node.status({ fill: "grey", shape: "dot", text: "stopped" })
    }
  }

  // start the dev server for the provided FlexDash dev-server and config nodes
  start(dev_node, fd) {
    try {
      // use try-catch to get stack backtrace of any error
      if (this.vite) this.stop()
      this.fd = fd
      this.dev_node = dev_node
      this.log = dev_node.log.bind(dev_node)
      this.warn = dev_node.warn.bind(dev_node)
      this.log(`starting dev server`)
      this.path = !fd || !fd.path || fd.path == "/" ? "/flexdash-dev" : fd.path + "-dev"
      this.log("source dir:" + this.sourceDir)
      this.log("URL path  :" + this.path)

      this.startVite().then(() => {})
    } catch (e) {
      console.error(e.stack)
      throw e
    }
  }

  // stop the dev server
  stop(dev_node) {
    if (this.dev_node != dev_node) return // hey: don't stop someone else's server!
    this.stopVite()
    this.dev_node.status({ fill: "grey", shape: "dot", text: "stopped" })
    this.dev_node = this.fd = null
  }

  // ===== Vite process management

  async startVite() {
    try {
      this.dev_node.status({ fill: "yellow", shape: "dot", text: "starting" })

      // install flexdash sources if necessary and desired
      if (this.install && !fs.existsSync(this.sourceDir)) {
        await this.installSrc()
      }

      // check misc stuff
      const err = this.checkSetup()
      if (err != "OK") {
        this.warn("Cannot start dev server: " + err)
        this.showStatus(err)
        return
      }

      // patch vite config file
      const viteConfig = await this.genViteConfig(this.path, this.sourceDir)
      // symlink xtra directory to external widgets
      await this.symlinkXtra(path.join(this.sourceDir, "xtra"), [process.cwd(), this.userDir])

      // launch process and register handlers for stdout/stderr
      const env = { HOME: process.env.HOME, PATH: process.env.PATH, SHELL: process.env.SHELL }
      // attempt at making things work under windows
      this.vite = cp.spawn("node", [this.viteBin, "-c", viteConfig, "--no-clearScreen"], {
        cwd: this.sourceDir,
        env,
        shell: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      // original linux-only
      // this.vite = cp.spawn(this.viteBin, ["-c", viteConfig, "--no-clearScreen"],
      //   { cwd: this.sourceDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      // )
      this.showStatus("OK")
    } catch (e) {
      this.warn(`*** FlexDash Dev server did not start: ${e.stack || e}`)
      this.dev_node.status({ fill: "red", shape: "dot", text: "see node-RED log" })
      this.dev_node = this.fd = this.vite = null
      return
    }

    // process std, primarily to find out which port vite is listening on
    this.vite.stdout.on("data", data => {
      data = data.toString()
      data = data.replace(/\u001b\[\d+m/g, "") // remove ANSI color codes
      console.log(data.replace(/[^\n]*\n/gs, "FD dev: $&").trimEnd())
      let m
      if ((m = data.match(/^\s+➜ *Local: *http:\/\/localhost:(\d+)\//m))) {
        this.vitePort = parseInt(m[1], 10)
        this.startProxying()
        this.viteReady = true
        this.log(`vite ready on port ${this.vitePort}`)
        this.showStatus("OK")
      }
    })

    this.vite.stderr.on("data", data => {
      const l = data
        .toString()
        .replace(/[^\n]*\n/gs, "FD dev ERR: $&")
        .trimEnd()
      console.log(l)
    })

    this.vite.on("close", code => {
      this.log("Vite exited with code " + code)
      this.stopVite()
    })
  }

  stopVite() {
    if (this.vite) {
      this.log("Stopping vite")
      this.vite.kill()
      this.vite = this.vitePort = this.viteReady = this.viteProxy = null
      this.showStatus("OK")
      if (this.viteProxy) this.stopProxying()
    }
  }

  // check that everything is set-up correctly for vite to run
  // returns "OK" or an error string suitable for node status if not
  checkSetup() {
    if (!fs.existsSync(this.sourceDir)) return `no ${this.sourceDir}`
    if (!fs.existsSync(this.viteBin)) return `no vite in ${this.sourceDir}`
    try {
      fs.accessSync(this.sourceDir, fs.constants.W_OK)
    } catch (e) {
      return `cannot write to ${this.sourceDir}`
    }
    if (!this.fd?.rootApp) return "FlexDash config node not deployed"
    return "OK"
  }

  // ===== proxy to vite

  // mungeResponse performs a replace(from, to) operation on the response body, adjusts the response
  // headers as needed.
  mungeResponse(url, resp, from, to) {
    let buff = []
    //console.log(`munge requesting ${url}`)
    const req = http.request(url, res => {
      delete res.headers["content-length"]
      delete res.headers["connection"]
      resp.writeHead(res.statusCode, res.statusMessage, res.headers)
      res.on("data", chunk => {
        buff.push(chunk)
      })
      res.on("end", () => {
        const data = buff.join("").replace(from, to)
        resp.end(data)
      })
    })
    req.on("error", e => {
      this.log(`${e} while proxying ${url}`)
      resp.status(500).end(`Error while proxying to vite`)
    })
    req.end()
  }

  // proxy to vite
  startProxying() {
    const proxyUrl = `http://localhost:${this.vitePort}`
    this.viteProxy = createProxyMiddleware({ target: proxyUrl + "/", ws: false, autoRewrite: true })
    // express does not support unmounting of handlers, so we have to fake it by interposing a
    // middleware, not great, but at least it works
    let wsSubscribed = false
    this.fd.rootApp.use(this.path, (req, res, next) => {
      //this.log(`PROXY ${req.baseUrl} ${req.path} ${req.url} (${req.originalUrl})`)
      if (!this.viteProxy) return next() // we're dead, wish we could unmount...

      // we can't ask http-proxy-middleware to deal with websockets because it has no way to remove
      // the subscription if we decide to stop & restart proxying. So we have to intercept http
      // upgrade requests ourselves and decide which proxy takes them. We can only register the
      // upgrade handler on the first request because we don't have access to the server object before.
      if (!wsSubscribed) {
        const server = (req.socket ?? req.connection)?.server // hack!
        server.on("upgrade", async (req, socket, head) => {
          let url = req.url || re.originalUrl
          if (url.endsWith("/")) url = url.slice(0, -1)
          if (this.viteProxy && url == this.path) this.viteProxy.upgrade(req, socket, head)
        })
        wsSubscribed = true
      }

      // proxy / to return munged index.html (insert socket.io url)
      if (req.path == "/") {
        const url = proxyUrl + req.baseUrl + "/index.html"
        const fd_opts = JSON.stringify({
          sio: `window.location.origin+'${this.fd.ioPath}'`, // .replace below removes outer """
          title: this.fd.name,
          no_add_delete: true,
          no_demo: true,
          edit_disabled: true,
        }).replace(/"(w[^"]*)"/, "$1")
        this.mungeResponse(url, res, "{}", fd_opts)

        // the following is no longer needed with vite 3.x
        // // proxy vite client source (/@vite.client) to munge vite's port
        // } else if (req.path == '/@vite/client') {
        //   // extract port from host header of incoming request
        //   const url = proxyUrl + req.baseUrl + req.path
        //   const m = req.get('Host').match(/^[^:]+:(\d+)/)
        //   const port = m ? parseInt(m[1], 10) : (req.protocol == "https" ? 443 : 80)
        //   this.mungeResponse(url, res, "1880/flexdash-dev/", `${port}/flexdash-dev/`)
      } else {
        this.viteProxy(req, res, next)
      }
    })
    this.log(`proxying ${this.path} to vite on port ${this.vitePort}`)
  }

  // ===== directories and files

  // generate vite config, we need to tweak paths and make sure it uses the correct port
  async genViteConfig(url_path, sourceDir) {
    const infile = path.join(this.sourceDir, "vite.config.js")
    const outfile = path.join(this.sourceDir, `.vite.config-dev.js`)
    let config = await fs.promises.readFile(infile, "utf8")
    // prep what we want
    const opts = {
      //root: tempDir,
      base: url_path + "/", // URL path to get to dev dashboard...
      logLevel: "info",
      server: {
        //hmr: { clientPort: 1880 }, // causes browser to be told to open ws to NR port
        fs: { allow: [sourceDir, process.cwd(), this.userDir] },
      },
    }
    // change base and add stuff in
    const optsJson = JSON.stringify(opts, null, 2).slice(1, -1) + ","
    config = config.replace(/^\s*base: .*/m, optsJson)
    await fs.promises.writeFile(outfile, config)
    return outfile
  }

  async symlinkXtra(xtraDir, dirs) {
    // remove existing symlinks
    try {
      await fs.promises.rm(xtraDir, { recursive: true })
    } catch (e) {}
    // create xtraDir
    await fs.promises.mkdir(xtraDir)
    // symlink to dirs that may have widgets
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
            for (const p of paths || []) {
              // p is of the form /<dir1>/.../<dirN>/widgets, need to create our own <dirN> and then
              // add a symlink ./<dirN>/widgets -> p
              const name = path.basename(path.dirname(p))
              // create dir, then create symlink in it
              this.log(`widgets: found ${name}`)
              try {
                await fs.promises.mkdir(path.join(xtraDir, name))
                await fs.promises.symlink(p, path.join(xtraDir, name, "widgets"), "junction")
              } catch (e) {
                if (e.message.includes("EEXIST")) {
                  console.log(`Warning: duplicate module ${name} found!`)
                } else {
                  console.log(e)
                  errs.push(e)
                }
              }
            }
          }
          // if we're done with all outstanding callbacks then resolve/reject the promise
          cnt--
          if (cnt == 0) {
            if (errs.length > 0) reject(new Error(errs.join(", ")))
            else resolve()
          }
        })(err, paths)
          .then(() => {})
          .catch(e => {
            console.log("Error in linkWidgetDir: " + e.stack)
          })
      }

      // iterate through all dirs, find widget dirs, and symlink them
      for (let dir of dirs) {
        dir = this.resolvePath(dir)
        this.log("widgets: searching in " + dir)
        cnt += 2 // launching two globs
        //glob(`${dir}/widgets`, linkWidgetDir)
        //glob(`${dir}/node-red-fd-*/widgets`, linkWidgetDir)
        glob(`${dir}/node_modules/node-red-fd-*/widgets`, linkWidgetDir)
        glob(`${dir}/node_modules/@*/node-red-fd-*/widgets`, linkWidgetDir)
      }
    })
    await prom
  }

  resolvePath(path) {
    if (path.startsWith("~/")) path = path.replace("~", process.cwd())
    else if (path.startsWith("./")) path = path.replace(".", this.userDir)
    return path
  }

  async installSrc() {
    // extract to sourceDir
    this.log("Extracting and installing flexdash sources to " + this.sourceDir)
    if (!fs.existsSync(this.sourceDir)) await fs.promises.mkdir(this.sourceDir)
    const tgz = path.join(__dirname, "flexdash-src.tgz")
    await tar.x({ file: tgz, cwd: this.sourceDir })
    this.dev_node.status({ fill: "yellow", shape: "dot", text: "running npm install" })
    let { stdout, stderr } = await exec("npm install --no-audit --no-fund", { cwd: this.sourceDir })
    if (stderr) {
      stderr = stderr.replace(/npm WARN [^\n]*\n/gs, "")
      if (stderr) this.warn("FlexDash source npm install\n" + stderr)
    }
  }

  // ===== run vite to bundle flexdash
  /* I don't think this is to be used anymore
  async genBundle() {
    try {
      // install flexdash sources if necessary and desired
      if (this.install && !fs.existsSync(this.sourceDir)) {
        await this.installSrc()
      }
      const err = this.checkSetup()
      if (err != "OK") throw new Error(err)

      // gen vite config
      const viteConfig = await this.genViteConfig(this.path, this.sourceDir)
      // symlink xtra directory to external widgets
      await this.symlinkXtra(path.join(this.sourceDir, "xtra"),
        [ process.cwd(), this.userDir ])

      // exec process and capture stdout/stderr
      const env = { HOME: process.env.HOME, PATH: process.env.PATH, SHELL: process.env.SHELL}
      const { stdout, stderr } = await execFile(
        this.viteBin, ["build", "-c", viteConfig, "--no-clearScreen"],
        { cwd: this.sourceDir, env, windowsHide: true }
      )

      // show stdout/stderr
      console.log(stdout.replace(/[^\n]*\n/gs, "FD bundle: $&").trimEnd())
      console.log(stderr.replace(/[^\n]*\n/gs, "FD bundle ERR: $&").trimEnd())
      console.log("*** FlexDash bundle complete!")
    } catch (e) {
      this.warn(`*** FlexDash bundling failed: ${e.stack || e}`)
    }
  }*/
}

// ===== NODE-RED NODE

module.exports = function (RED) {
  var viteDevServer = new ViteDevServer(RED, true)

  // Development server based on vite to serve up a dev version of the FlexDash dashboard.
  // 'this' is the node being constructed and config are the values set in the flow editor.
  class flexdashDevServer {
    constructor(config) {
      try {
        // use try-catch to get stack backtrace of any error
        const fd = RED.nodes.getNode(config.fd) // get a handle onto FlexDash
        RED.nodes.createNode(this, config)
        if (!fd) return // nothing we can do...

        this.fd = fd
        this.enable = config.enable
        this.name = fd?.name || "FlexDash"

        if (this.enable) {
          // delay startVite a tad so the rest of the flow can finish init'ing in peace
          setTimeout(() => viteDevServer.start(this, this.fd), 500)
        } else {
          this.status({ fill: "grey", shape: "dot", text: "stopped" })
        }
      } catch (e) {
        console.error(e.stack)
        throw e
      }

      this.on("close", () => viteDevServer.stop())

      // handle flow input messages, basically massage them a bit and update the FD widget
      this.on("input", msg => {
        RED.log.debug("on-input:", JSON.stringify(msg))
        switch (msg.payload) {
          case "stop":
            viteDevServer.stop(this)
            break
          case "restart":
            viteDevServer.stop(this)
            viteDevServer.start(this, this.fd)
            break
          case "start":
            viteDevServer.start(this, this.fd)
            break
          //case "bundle": viteDevServer.genBundle(); break
          default:
            this.warn(`unknown command: ${msg.payload}, expected "start", "stop", "restart"`)
        }
      })
    }
  }

  RED.nodes.registerType("flexdash dev server", flexdashDevServer)

  // POST handler for button in flow editor, copied from inject node
  RED.httpAdmin.post(
    "/fd-dev-server/:id/restart",
    RED.auth.needsPermission("inject.write"),
    function (req, res) {
      var node = RED.nodes.getNode(req.params.id)
      if (node != null) {
        try {
          node.receive({ payload: "restart" })
          // if (req.body && req.body.__user_fddev_props__) {
          //   node.receive(req.body)
          // } else {
          //   node.receive()
          // }
          res.sendStatus(200)
        } catch (err) {
          res.sendStatus(500)
          node.error("FlexDash dev server restart failed:" + err.toString())
        }
      } else {
        res.sendStatus(404)
      }
    }
  )
}
