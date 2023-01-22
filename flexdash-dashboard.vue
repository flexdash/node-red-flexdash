<!-- FlexDash config node for Node-RED
     Copyright ©2021-2023 by Thorsten von Eicken, see LICENSE
-->

<template>
  <nr-tabs :tabs="['Config', 'Contents']" v-model="uitab" v-bind="$attrs" />
  <!-- Config tab -->
  <div v-show="uitab === 0" class="w:full">
    <nr-props-grid>
      <nr-label>Dashboard name</nr-label>
      <nr-string-input
        :modelValue="name"
        @update:modelValue="$emit('update:prop', 'name', $event)"
        tip="The name is shown in the dashboard's title bar." />

      <p class="grid-col-span:2">
        <b>To access this dashboard</b> point your browser at
        <a class="font:bold fg:blue-50" :href="browserPath">{{ browserPath }}</a>
      </p>

      <!-- Advanced options -->
      <hr class="my:1ex grid-col-span:2" />
      <div class="flex mb:1ex grid-col-span:2 cursor:pointer" @click="advanced = !advanced">
        <i :class="`w:1ex fa fa-caret-` + (advanced ? 'down' : 'right')" />
        <b class="ml:1ex">Advanced configuration options</b>
      </div>
    </nr-props-grid>

    <nr-props-grid v-if="advanced">
      <p class="grid-col-span:2 font:bold">
        These options do not need to be changed for standard use of FlexDash!
      </p>

      <nr-label>Built-in webserver</nr-label>
      <nr-checkbox-input
        :modelValue="redServer"
        @update:modelValue="$emit('update:prop', 'redServer', $event)"
        tip="If checked, the dashboard will be served by Node-RED's built-in webserver (recommended).
      If unchecked, the dashboard will be served on a separate port." />

      <nr-label v-if="!redServer">Port</nr-label>
      <nr-number-input
        v-if="!redServer"
        :modelValue="port"
        @update:modelValue="$emit('update:prop', 'port', $event)"
        tip="The port on which the dashboard will be served." />

      <nr-label>Dashboard URL Path</nr-label>
      <nr-string-input
        :modelValue="path"
        @update:modelValue="$emit('update:prop', 'path', $event)"
        tip="The URL path is relative to the httpNodeRoot setting when using Node-RED's built-in
      webserver and absolute otherwise. The path should have a leading slash but no trailing slash
      (except for the '/' case). If you serve multiple dashboards from the Node-RED built-in
      webserver they all must have distinct paths." />

      <nr-label>CORS all origins</nr-label>
      <nr-checkbox-input
        :modelValue="allOrigins"
        @update:modelValue="$emit('update:prop', 'allOrigins', $event)"
        tip="If checked, Node-RED-FlexDash will configure CORS to allow requests from any origin.
      If unchecked, CORS will be configured to only allow requests from the same origin as the
      dashboard itself." />

      <nr-label>Custom socket.io options</nr-label>
      <nr-string-input
        :modelValue="ioOpts"
        @update:modelValue="$emit('update:prop', 'ioOpts', $event)"
        tip="JSON options passed to socket.io's `new Server()`" />
    </nr-props-grid>
  </div>

  <!-- Contents tab -->
  <fd-list-sorter v-show="uitab === 1" :items="children" @update:items="updateChildren">
    <template v-slot="{ item }">
      <div class="w:full flex b:1|solid|gray-70 r:4 my:0.5ex px:1ex pt:1ex pb:0.5ex">
        <div class="w:10ex fg:gray-60">{{ fmtType(item.type) }}</div>
        <fd-fmt-node-label class="flex-grow:1 overflow:hidden" :node="item" />
        <div class="w:20ex overflow:hidden text:ellipsis white-space:nowrap fg:gray-60">
          {{ fmtIcon(item.icon) }}
        </div>
        <i class="fa fa-arrows-v pl:1ex" />
      </div>
    </template>
  </fd-list-sorter>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  name: "EditFlexdashDashboard",
  props: {
    port: { default: 80, type: Number, required: true },
    ioOpts: { default: "{}" }, // additional custom socket.io options
    path: { default: "/flexdash" }, // path to load flexdash from
    redServer: { default: true, type: Boolean }, // use Node-RED's express server
    saveConfig: { default: true, type: Boolean }, // save FlexDash config
    allOrigins: { default: false, type: Boolean }, // enable all origins using CORS
    // devServer: { default: false, type: Boolean }, // enable development server
    // devInstall: { default: false, type: Boolean }, // enable installation of development server
    name: { default: "FlexDash", required: true }, // dashboard title
    fd_children: { default: "", type: String }, // comma-separated list of child node IDs
  },
  data() {
    return {
      uitab: 0,
      advanced: false,
    }
  },
  computed: {
    browserPath() {
      const httpNodeRoot = RED.settings.httpNodeRoot
      const loc = globalThis.location
      let base
      if (this.redServer) {
        base = loc.origin + (httpNodeRoot != "/" ? httpNodeRoot : "")
      } else {
        base = `${loc.protocol}//${loc.hostname}:${this.port}`
      }
      return base + this.path
    },
    child_ids() {
      return this.fd_children.split(",").slice(1)
    },
    children() {
      // FIXME: deal with missing nodes
      return this.child_ids.map(id => RED.nodes.node(id)).filter(n => n)
    },
  },

  mounted() {
    // help button in top tray bar - thanks Kevin!
    $(
      '<button type="button" class="ui-button ui-corner-all ui-widget">' +
        '<i class="fa fa-book"></i> help</button>'
    )
      .on("click", () => {
        RED.sidebar.help.show(this.type)
      })
      .insertBefore($("#node-config-dialog-cancel"))
  },

  methods: {
    updateChildren(cc) {
      this.$emit("update:prop", "fd_children", cc.map(c => "," + c.id).join(""))
    },
    fmtType(t) {
      t = t.replace(/^flexdash\s*/, "")
      return t[0].toUpperCase() + t.slice(1)
    },
    fmtIcon(i) {
      return i ? i.replace(/^mdi-/, "") : ""
    },
  },

  node_red: {
    category: "config",
    hasUsers: false, // prevent unused config node warning

    label() {
      const port = this.redServer ? window.location.port : this.port.toString()
      let path = this.redServer ? RED.settings.httpNodeRoot + this.path : this.path
      path = path.replace(/^\/*(.*?)\/*$/, "/$1")
      return `${this.name || "FlexDash"}:${port}${path}`
    },
  },

  help: `Configures the FlexDash service

Each FlexDash dashboard node corresponds to a web page that displays a dashboard with multiple
tabs filled with widgets. You can create multiple dashboards using multiple config nodes and
assign different ports or different paths to each one in the advanced options.

## Advanced Options

The FlexDash server can \`use Node-RED's built-in webserver\`, i.e., the same protocol,
hostname, and port as the admin UI. Alternatively, the server can be started on a separate
\`port\`, typically to apply different security parameters to its access.

The \`custom socket.io options\` can be used to specify additional socket.io options per
the [socket.io docs](https://socket.io/docs/v4/server-initialization/#Options).
For example, more nuanced CORS policies can be implemented.
The config node logs the socket.io options used when it initializes,
these can be used as a starting point.
`,
})
</script>
