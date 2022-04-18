// Widget API - a set of methods that can be called from nodes to interact with FlexDash and
// the widget associated with the node.
// Copyright ©2021 by Thorsten von Eicken, see LICENSE

// FlexDash widget API
module.exports = class WidgetAPI {
  // Each NRFDAPI object provides the API calls to one Node-RED node
  constructor(node, plugin) {
    this.node = node
    this.plugin = plugin // flexdash plugin
    this.widget_id = node._fd_id
  }
  
  // checkProp verifies that a prop being set dynamically actually exists by looking whether
  // there's a static setting for it. There really isn't much harm in setting a non-existent
  // prop so this check could be eliminated. It's here because it provides early feedback in
  // the common case where it's a actually an error.
  _checkProp(widget, prop) {
    if (!(prop in widget.static)) {
      this.node.warn(`Widget of node ${this.node.id} has no prop '${prop}'`)
    }
  }

  // setProps updates the widget's dynamic props with the passed values (typ. msg.props)
  // For each dynamic prop we need to store the value in /node-red/<widget_id>/<param> and
  // ensure that the widget's dynamic/<param> field points there. Unless a param's value is
  // null, in which case we remove the pointer so the static value is used.
  // topic is used to index into an array (ArrayGrid), unused if not part of an array.
  setProps(topic, props) {
    for (const prop in props) {
      this.set(topic, prop, props[prop])
    }
  }

  // set update a widget prop given a path (prop/any/path/below/it)
  set(topic, path, value=undefined) {
    try {
      const prop = path.split('/')[0]
      let widget_id = this.widget_id
      // for arrays, we need to find the actual widget...
      console.log("set", topic, path, value, this.node._fd_kind)
      if (this.node._fd_kind) { // only widgets in arrays have the kind saved away
        let topic_key = topic, topic_sort = topic
        if (Array.isArray(topic) && topic.length != 2) {
          topic_key = topic[0]
          topic_sort = topic[1]
        }
        if (typeof topic_key != 'number' && typeof topic_key != 'string' ||
            typeof topic_sort != 'number' && typeof topic_sort != 'string') {
          throw new Error("[msg.]topic must be a number or string")
        }
        this.plugin._addArrayTopic(this.node._fd_container, topic_key, topic_sort)
        widget_id = this.widget_id + '-' + topic_key
      }
      const w = this.node._fd.store.widgetByID(widget_id)

      // construct flexdash path and check widget actually has prop
      const fdpath = `${w.dyn_root}/${path}`
      this._checkProp(w, prop)

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

  // onInput registers the handler of a node so it gets it's corresponding widget's output
  onInput(handler) {
    if (typeof handler !== 'function') throw new Error("onInput handler must be a function")
    this.node._fd.inputHandlers[this.node.id] = handler
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
