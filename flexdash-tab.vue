<!-- FlexDash tab node for Node-RED
     Copyright ©2022-2023 by Thorsten von Eicken, see LICENSE
-->
<template>
  <nr-tabs :tabs="['Config', 'Contents']" v-model="uitab" v-bind="$attrs" />
  <!-- Config tab -->
  <div v-show="uitab === 0" class="w:full">
    <nr-props-grid>
      <nr-label>Name</nr-label>
      <nr-string-input
        :modelValue="name"
        @update:modelValue="$emit('update:prop', 'name', $event)"
        tip="Name of tab config node in Node-RED. Not displayed in dashboard." />

      <nr-label>Title</nr-label>
      <nr-string-input
        :modelValue="title"
        @update:modelValue="$emit('update:prop', 'title', $event)"
        tip="Name shown in the dashboard's tab bar. Leave Empty to only show icon." />

      <nr-label>Icon</nr-label>
      <div class="flex flex:col nr-input-tip">
        <nr-string-input
          :modelValue="icon"
          @update:modelValue="$emit('update:prop', 'icon', $event)" />
        <div class="text:85% pt:4 nr-fmt-tip">
          Material design icon to show in tab bar. Include the 'mdi-' prefix. Choose at
          <a class="text:underline" href="https://materialdesignicons.com" target="_blank"
            >https://materialdesignicons.com</a
          >
        </div>
      </div>

      <nr-label>Dashboard</nr-label>
      <nr-config-input
        :modelValue="fd"
        @update:modelValue="$emit('update:prop', 'fd', $event)"
        prop-name="fd"
        :configTypes="['flexdash dashboard']"
        tip="Dashboard to which this tab belongs."
        v-slot="slotProps">
        <fd-fmt-node-label :node="slotProps.node" />
      </nr-config-input>
    </nr-props-grid>
  </div>

  <!-- Content tab -->
  <fd-list-sorter v-show="uitab === 1" :items="children" @update:items="updateChildren">
    <template v-slot="{ item }">
      <div class="w:full flex b:1|solid|gray-70 r:4 my:0.5ex px:1ex pt:1ex pb:0.5ex">
        <div class="w:10ex fg:gray-60">{{ item.kind }}</div>
        <fd-fmt-node-label class="flex-grow:1 overflow:hidden" :node="item" />
        <i class="fa fa-arrows-v ml:auto pl:1ex" />
      </div>
    </template>
  </fd-list-sorter>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  name: "EditFlexdashTab",
  props: {
    name: { type: String, required: false },
    icon: { type: String, default: "mdi-view-dashboard", required: false },
    title: { type: String, required: false },
    fd_children: { type: String, default: "" }, // comma-separated list of child node IDs
    // node id of dashboard, intentionally not declared with a config_type in order not
    // to create an export dependency
    fd: {
      type: String,
      default: "", // node id of dashboard
      // validate(v, l) {
      //   const configNode = RED.nodes.node(v || this.fd)
      //   if (configNode == null) return "Dashboard not found"
      //   if (configNode.valid == null || configNode.valid) return true
      //   return "Dashboard not valid"
      // },
    },
  },

  data() {
    return {
      uitab: 0,
    }
  },

  computed: {
    child_ids() {
      return this.fd_children.split(",").slice(1)
    },
    children() {
      // FIXME: deal with missing nodes
      return this.child_ids.map(id => RED.nodes.node(id)).filter(n => n)
    },
  },

  methods: {
    updateChildren(cc) {
      this.$emit("update:prop", "fd_children", cc.map(c => "," + c.id).join(""))
    },
  },

  node_red: {
    category: "config",
    label() {
      const i = this.icon && this.icon.replace(/^mdi-/, "")
      return this.name || i || "FlexDash tab"
    },
    labelStyle() {
      return this.name ? "node_label_italic" : ""
    },
  },

  help: `FlexDash tab.
This config node represents a tab in a FlexDash dashboard.
It is shown in the top bar across the top of the web page and contains a series of
grids, each grid being full width and variable height.
The tab node has a title and an icon, both of which are optional.
On mobile devices the tabs are shown as a hamburger menu.
`,
})
</script>
