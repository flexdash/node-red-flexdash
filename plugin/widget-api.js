// Widget API - a set of methods that can be called from nodes to interact with FlexDash and
// the widget associated with the node.
// Copyright ©2021 by Thorsten von Eicken, see LICENSE

// FlexDash widget API, each WidgetAPI object provides API calls to one Node-RED node
module.exports = class WidgetAPI {
  constructor(node, plugin) {
    this.node = node
    this.plugin = plugin // flexdash plugin
  }

  // setProps updates the widget's dynamic props with the passed values (typ. msg.props)
  // For each dynamic prop we need to store the value in /node-red/<widget_id>/<prop> and
  // ensure that the widget's dynamic/<prop> field points there. Unless a prop's value is
  // null, in which case we remove the pointer so the static value is used.
  // options may contain topic and socket.
  // topic is used to index into an array (ArrayGrid), unused if not part of an array.
  // socket is used to set the value only for a specific socket (i.e. client).
  setProps(props, options = {}) {
    for (const prop in props) {
      if (prop.startsWith("_")) continue // skip internal props
      this.set(prop, props[prop], options)
    }
  }

  // set update a widget prop given a path (prop/any/path/below/it)
  // options may contain topic and socket.
  // topic is used to index into an array (ArrayGrid), unused if not part of an array.
  // socket is used to set the value only for a specific socket (i.e. client).
  set(path, value, options = {}) {
    try {
      let { topic, socket } = options
      const prop = path.split("/")[0]
      const w = this._getWidget(topic)

      // construct flexdash path and check widget actually has prop
      const fdpath = `${w.dyn_root}/${path}`
      if (!(prop in w.static)) {
        // widget doesn't have this prop, don't set it 'cause it may be a huge data structure
        // causing havoc, Node-RED convention is to ignore unkonwn msg.xxx fields
        //this.node.debug(`FD set: widget doesn't have prop ${prop}, has: ${Object.keys(w.static)}`)
        return
      }

      // check unicast/broadcast permissions set in the enclosing grid
      const grid = this.node._fd_container?.getGrid()
      if (grid) {
        const unicast = grid.config.unicast
        if (unicast == "ignore" && socket) {
          socket = null
        } else if (unicast == "disallow" && socket) {
          this.node.warn(
            `incoming message discarded: _fd_socket is disallowed for grid ${grid.name || grid.id}`
          )
          return
        } else if (unicast == "require" && !socket) {
          this.node.warn(
            `incoming message discarded: _fd_socket is required for grid ${grid.name || grid.id}`
          )
          return
        }
      } else {
        this.node.warn(`Internal: widget ${w.id} not in a grid?`)
        console.log(this.node)
        console.log(this.node._fd_container)
      }

      // set or unset prop
      if (value !== undefined) {
        this.setAbsPath(fdpath, value, socket)
        this._makeDynamic(w, prop, socket)
      } else {
        this.deleteAbsPath(fdpath, socket)
        if (path == prop) this._makeStatic(w, prop, socket)
      }
    } catch (e) {
      this.node.warn(`Failed to update widget prop path '${path}':\n${e.stack}`)
    }
  }

  get(path, options = {}) {
    try {
      const { topic, socket } = options
      if (socket) {
        this.node.error(`WidgetAPI.get() not supported for unicast (_fd_socket!=null)`)
        return undefined
      }
      const prop = path.split("/")[0]
      const w = this._getWidget(topic)

      // check widget actually has prop
      if (!(prop in w.static)) return undefined

      const fdpath = `${w.dyn_root}/${path}`
      if (w.dynamic[prop]) return this.node._fd.store.get(fdpath)
      else return w.static[prop]
    } catch (e) {
      this.node.warn(`Failed to get widget prop path '${path}':\n${e.stack}`)
    }
  }

  _push_shift(op, path, value, options) {
    try {
      const { topic, socket } = options
      const prop = path.split("/")[0]
      const w = this._getWidget(topic)

      // construct flexdash path and check widget actually has prop
      const fdpath = `${w.dyn_root}/${path}`
      if (!(prop in w.static)) return

      // slightly different semantics if we're storing locally vs. unicasting to a socket
      // to store locally we ensure we have an array, unicast we just fire-off the push
      this._makeDynamic(w, prop, socket)
      if (!socket) this.node._fd.store[op](fdpath, value)
      this.node._fd._send(op, fdpath, value, socket)
    } catch (e) {
      this.node.warn(`Failed to ${op} to widget prop path '${path}':\n${e}`)
    }
  }

  push(path, value, options = {}) {
    this._push_shift("push", path, value, options)
  }
  shift(path, options = {}) {
    this._push_shift("shift", path, undefined, options)
  }

  // delete data from a widget prop given a path (prop/any/path/below/it)
  // options may contain topic and socket.
  // topic is used to index into an array (ArrayGrid), unused if not part of an array.
  // socket is used to set the value only for a specific socket (i.e. client).
  delete(path, options = {}) {
    this.set(path, undefined, options)
  }

  // for array-widgets, delete a specific topic, removing the corresponding widget
  deleteTopic(topic) {
    if (this.node._fd_array_max) {
      if (typeof topic != "number" && typeof topic != "string") {
        throw new Error("[msg.]topic must be a number or string")
      }
      this.plugin._deleteWidgetTopic(this.node, topic)
    }
  }

  // onInput registers the handler of a node so it gets it's corresponding widget's output
  onInput(handler) {
    if (typeof handler !== "function") throw new Error("onInput handler must be a function")
    this.node._fd.inputHandlers[this.node._fd_id] = handler
  }

  destroyNode() {
    // deregister input handler
    delete this.node._fd.inputHandlers[this.node._fd_id]
  }

  // setAbsPath sets the value at an absolute path in the FlexDash data tree
  setAbsPath(path, value, socket) {
    if (!socket) this.node._fd.store.set(path, value)
    this.node._fd._send("set", path, value, socket)
  }

  // deleteAbsPath removes the value at an absolute path in the FlexDash data tree
  deleteAbsPath(path, socket) {
    if (!socket) this.node._fd.store.set(path, undefined)
    this.node._fd._send("unset", path, null, socket) // given JSON, undefined==null
  }

  // ===== internal methods =====

  // given a topic, return the widget config object
  // internal-only
  _getWidget(topic) {
    let widget_id = this.node._fd_id
    //console.log(`FD set ${topic}/${path} = ${value}  ${this.node._fd_kind||""}`)

    // for arrays, we need to determine the actual widget...
    if (this.node._fd_array_max) {
      if (typeof topic != "number" && typeof topic != "string") {
        throw new Error(`msg.topic must be a number or string, not ${typeof topic}`)
      }
      this.plugin._addWidgetTopic(this.node, topic) // only adds if it doesn't exist yet
      widget_id = this.plugin._genArrayFDId(widget_id, topic)
    }
    return this.node._fd.store.widgetByID(widget_id)
  }

  // ensure that the widget's dynamic/<prop> field is true
  _makeDynamic(w, prop, socket) {
    if (w.dynamic[prop] !== true) {
      if (socket) this.setAbsPath(`$config/widgets/${w.id}/dynamic/${prop}`, true, socket)
      else this.node._fd.store.updateWidgetProp(w.id, "dynamic", prop, true)
    }
  }

  _makeStatic(w, prop, socket) {
    if (prop in w.dynamic) {
      if (socket) this.deleteAbsPath(`$config/widgets/${w.id}/dynamic/${prop}`, socket)
      else this.node._fd.store.updateWidgetProp(w.id, "dynamic", prop, undefined)
    }
  }
}
