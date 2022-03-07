// ViteServer - Serve up a front-end page using vite
// Copyright ©2022 Thorsten von Eicken, MIT license, see LICENSE file

const path = require('path')
const express = require('express')
const util = require('util')
const fs = require('fs')
const exec = util.promisify(require('child_process').exec)

const NPM_COMMAND = (process.platform === "win32") ? "npm.cmd" : "npm"

class ViteServer {
  constructor() {
    this.app = null // express app
    this.vite = null // vite module
    this.viteErr = null // error loading module
    this.viteServer = null // result of vite.createServer()
  }

  hasVite() {
    if (this.vite) return true
    try {
      // problem: once a require(x) fails it will always fail even if x is installed in the meantime
      // so we only require('vite') if we can find the directory
      const viteDir = path.join(process.cwd(), 'node_modules', 'vite')
      if (!fs.existsSync(viteDir)) {
        this.viteErr = "Cannot find " + viteDir
        return false
      }
      this.vite = require('vite')
      return true
    } catch (e) {
      console.log(e)
      console.log("Require cache:", Object.keys(require.cache).filter(m=>m.includes('vite')).join(", "))
      this.viteErr = e
      return false
    }
  }
  
  async createServer(
    srcPath, // directory path to root of source tree
    indexHtml, // directory path to root html file to load (typ <devSrcPath>/index.html)
    mountPath, // path where the vite server will be mounted on
    server, // http server on which the websocket will be mounted
  ) {
    if (!this.hasVite()) throw this.viteErr

    const app = express()
    const vite = await this.vite.createServer({
      root: srcPath,
      base: mountPath,
      logLevel: 'info',
      server: {
        middlewareMode: true,
        hmr: { server, port: 1880 },
        watch: {
          // During tests we edit the files too fast and sometimes chokidar
          // misses change events, so enforce polling for consistency
          usePolling: true,
          interval: 100
        }
      }
    })
    // use vite's connect instance as middleware
    app.use(vite.middlewares)

    app.use(async (req, res) => {
      try {
        const url = req.originalUrl
        console.log("Vite index HTML: " + url)

        let template, render
        // always read fresh template in dev
        template = await vite.transformIndexHtml(url, indexHtml)
        //render = (await vite.ssrLoadModule('/src/entry-server.js')).render

        //const [appHtml, preloadLinks] = await render(url, manifest)

        const html = template
          // .replace(`<!--preload-links-->`, preloadLinks)
          // .replace(`<!--app-html-->`, appHtml)

        res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
      } catch (e) {
        vite && vite.ssrFixStacktrace(e)
        console.log(e.stack)
        res.status(500).end(e.stack)
      }
    })

    return { app, vite }
  }

  async installVite() {
    try {
      if (this.vite) return
      console.log("Installing vite in", process.cwd())
      const { stdout, stderr } = await exec(`${NPM_COMMAND} install --save vite`)
      console.log(stdout.replace(/^/gm, 'NPM: '))
      if (stderr) console.log(stderr)
      this.viteErr = null
      this.vite = require('vite')
    } catch (e) {
      console.log("Err in install")
      if (e.stdout) console.log("NPM OUT:" + e.stdout)
      if (e.stderr) console.log(e.stderr)
      this.vite = false
      this.viteErr = e
      throw e
    }
  }

}

module.exports = new ViteServer()
