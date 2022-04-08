// Widget API - a set of methods that can be called from nodes to interact with FlexDash and
// the widget associated with the node.
// Copyright ©2021 by Thorsten von Eicken, see LICENSE



// FlexDash widget API
module.exports = class WidgetAPI {
  // Each NRFDAPI object provides the API calls to one Node-RED node
  constructor(fd, widget_id, node) {
    console.log(`WidgetAPI ${fd} ${widget_id} ${Object.keys(node)}`)
    this.fd = fd
    this.widget_id = widget_id
    this.node = node
  }
  
  _checkProp(widget, prop) {
    if (!(prop in widget.static)) {
      this.node.warn(`Widget of node ${this.node.id} has no prop '${prop}'`)
    }
  }

  // setProps updates the widget's dynamic props with the passed values (typ. msg.props)
  // For each dynamic prop we need to store the value in /node-red/<widget_id>/<param> and
  // ensure that the widget's dynamic/<param> field points there. Unless a param's value is
  // null, in which case we remove the pointer so the static value is used.
  setProps(props) {
    for (const prop in props) {
      this.set(prop, props[prop])
    }
  }

  // set update a widget prop given a path (prop/any/path/below/it)
  set(path, value=undefined) {
    try {
      const w = this.fd.store.widgetByID(this.widget_id)
      const prop = path.split('/')[0]
      const fdpath = `node-red/${this.widget_id}/${path}`
      const fdprop = `node-red/${this.widget_id}/${prop}`
      this._checkProp(w, prop)

      if (value !== undefined) {
        this.setAbsPath(fdpath, value)
        // ensure that the widget's dynamic/<prop> field points there
        if (w.dynamic[prop] != fdprop) {
          this.fd.store.updateWidgetProp(this.widget_id, 'dynamic', prop, fdprop)
        }
      } else {
        this.deleteAbsPath(path)
        if (path == prop && prop in w.dynamic) {
          this.fd.store.updateWidgetProp(this.widget_id, 'dynamic', p, null)
        }
      }

    } catch (e) {
      this.node.warn(`Failed to update widget prop path '${path}':\n${e.stack}`)
    }
  }

  // delete data from a widget prop given a path (prop/any/path/below/it)
  delete(path) { this.set(path) }

  // onInput registers the handler of a node so it gets it's corresponding widget's output
  onInput(handler) {
    if (typeof handler !== 'function') throw new Error("onInput handler must be a function")
    this.fd.inputHandlers[this.node.id] = handler
  }

  // setAbsPath sets the value at an absolute path in the FlexDash data tree
  setAbsPath(path, value) {
    this.fd.store.set(path, value)
    this.fd.io.emit("set", path, value)
  }

  // deleteAbsPath removes the value at an absolute path in the FlexDash data tree
  deleteAbsPath(path) {
    this.fd.store.set(path, undefined)
    this.fd.io.emit("unset", path)
  }

}