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
  // For each dynamic prop we need to store the value in /node-red/<widget_id>/<param> and
  // ensure that the widget's dynamic/<param> field points there. Unless a param's value is
  // null, in which case we remove the pointer so the static value is used.
  // topic is used to index into an array (ArrayGrid), unused if not part of an array.
  setProps(topic, props) {
    for (const prop in props) {
      if (prop.startsWith('_')) continue // skip internal props
      this.set(topic, prop, props[prop])
    }
  }

  // set update a widget prop given a path (prop/any/path/below/it)
  set(topic, path, value=undefined) {
    try {
      const prop = path.split('/')[0]
      let widget_id = this.node._fd_id
      //console.log(`FD set ${topic}/${path} = ${value}  ${this.node._fd_kind||""}`)

      // for arrays, we need to determine the actual widget...
      if (this.node._fd_array_max) {
        if (typeof topic != 'number' && typeof topic != 'string') {
          throw new Error(`msg.topic must be a number or string, not ${typeof topic}`)
        }
        this.plugin._addWidgetTopic(this.node, topic) // only adds if it doesn't exist yet
        widget_id = this.plugin._genArrayFDId(widget_id, topic)
      }
      const w = this.node._fd.store.widgetByID(widget_id)

      // construct flexdash path and check widget actually has prop
      const fdpath = `${w.dyn_root}/${path}`
      if (!(prop in w.static)) {
        // widget doesn't have this prop, don't set it 'cause it may be a huge data structure
        // causing havoc, Node-RED convention is to ignore unkonwn msg.xxx fields
        //console.log(`FD set: widget doesn't have prop ${prop}, has: ${Object.keys(w.static)}`)
        return
      }

      // set or unset prop                                           FIXME: save into dynamics
      if (value !== undefined) {
        this.setAbsPath(fdpath, value)
        // ensure that the widget's dynamic/<prop> field is true
        if (w.dynamic[prop] !== true) {
          this.node._fd.store.updateWidgetProp(widget_id, 'dynamic', prop, true)
        }
      } else {
        this.deleteAbsPath(path)
        if (path == prop && prop in w.dynamic) {
          this.node._fd.store.updateWidgetProp(widget_id, 'dynamic', prop, undefined)
        }
      }
    } catch (e) {
      this.node.warn(`Failed to update widget prop path '${path}':\n${e.stack}`)
    }
  }

  // delete data from a widget prop given a path (prop/any/path/below/it)
  delete(topic, path) { this.set(topic, path, undefined) }

  // for array-widgets, delete a specific topic, removing the corresponding widget
  deleteTopic(topic) {
    if (this.node._fd_array_max) {
      if (typeof topic != 'number' && typeof topic != 'string') {
        throw new Error("[msg.]topic must be a number or string")
      }
      this.plugin._deleteWidgetTopic(this.node, topic)
    }
  }

  // onInput registers the handler of a node so it gets it's corresponding widget's output
  onInput(handler) {
    if (typeof handler !== 'function') throw new Error("onInput handler must be a function")
    this.node._fd.inputHandlers[this.node._fd_id] = handler
  }

  // setAbsPath sets the value at an absolute path in the FlexDash data tree
  setAbsPath(path, value) {
    this.node._fd.store.set(path, value)
    this.node._fd.io.emit("set", path, value)
  }

  // deleteAbsPath removes the value at an absolute path in the FlexDash data tree
  deleteAbsPath(path) {
    this.node._fd.store.set(path, undefined)
    this.node._fd.io.emit("unset", path)
  }

}
