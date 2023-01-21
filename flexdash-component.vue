<template>
  <div class="h:full">
    <div class="flex flex:col h:full">
      <nr-tabs :tabs="['Config', 'Component code']" v-model="tab" />
      <!-- Component Code tab -->
      <nr-code-editor
        v-show="tab === 1"
        :modelValue="sfc_source"
        @update:modelValue="$emit('update:prop', 'sfc_source', $event)" />

      <!-- Config tab -->
      <div v-show="tab === 0" class="w:full">
        <nr-props-grid>
          <nr-label>Name</nr-label>
          <nr-string-input
            :modelValue="name"
            @update:modelValue="$emit('update:prop', 'name', $event)"
            tip="Name of node in Node-RED, not shown in dashboard." />

          <nr-label>Component Name</nr-label>
          <nr-string-input
            :modelValue="sfc_name"
            @update:modelValue="$emit('update:prop', 'sfc_name', $event)"
            tip="Name of the component, used in HTML tags to refer to it.
            Must be kebab-case (lower-case plus dash, like 'my-awesome-component').
            Must be globally unique in the dashboard: a project name prefix is recommended." />

          <nr-label>Dashboard</nr-label>
          <nr-config-input
            :modelValue="fd"
            @update:modelValue="$emit('update:prop', 'fd', $event)"
            prop-name="fd"
            :configTypes="['flexdash dashboard']"
            tip="Dashboard to register the component with."
            v-slot="slotProps">
            {{ format_config_node(slotProps.node) }}
          </nr-config-input>
        </nr-props-grid>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  name: "EditFlexdashCustom",
  props: {
    name: { type: String, required: false },
    sfc_source: { type: String, required: false },
    // node id of dashboard, intentionally not declared with a config_type in order not
    // to create an export dependency (see also the flexdash tab node)
    fd: { default: "", type: String, required: false },
  },
  data: () => ({
    tab: 0,
  }),
  methods: {
    propagate(prop, value) {
      this.$emit("update:prop", prop, value)
    },
  },
  node_red: {
    category: "flexdash",
    color: "#F0E4B8",
    label() {
      return this.name || "flexdash-component"
    },
    labelStyle() {
      return this.name ? "node_label_italic" : ""
    },
  },
  help: `Custom component for FlexDash.
Write a Vue component that can be used in widgets and other components,
directly in the Node-RED editor.

A custom widget consists of two parts:
1. the component source code that gets loaded into FlexDash
2. configuration, including imports, in the config tab

### Custom Widget vs. Custom Component

A FlexDash _custom component_ is a Vue component that can be instantiated in another
component's template using a \`<my-component-name>\` tag. It has props that can be
passed in from the parent component and emits events that can be handled by the parent.
_Custom components_ are thus useful as reusable units that can be used in _custom widgets_
and other _custom components_.

A FlexDash _custom widget_ is a Vue component plus a Node-RED node.
A _custom widget_ shows up as a node in the Node-RED flow, can receive data from that node,
send events to that node, and can be placed in grids and panels.
A _custom component_ has no representation in the Node-RED flow,
there is no node in the flow, there is no mechanism for passing data between Node-RED and
the _custom component_ or to place the component in a grid or panel other than as a
child component of a _custom widget_.

## Component Source Code

Please refer to the help for the CustomWidget node.

## Importing and linking

Please refer to the help for the CustomWidget node.
`,
})
</script>
