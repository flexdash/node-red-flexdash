<template>
  <div class="h:full">
    <div class="flex flex:col h:full">
      <nr-tabs :tabs="['General', 'Widget code', 'Config']" v-model="tab" />
      <!-- General tab -->
      <fd-general-tab v-show="tab === 0" @update:prop="propagate" />

      <!-- Widget Code tab -->
      <nr-code-editor
        v-if="blink" v-show="tab === 1"
        :modelValue="sfc_source"
        @update:modelValue="$emit('update:prop', 'sfc_source', $event)" />

      <!-- Config tab -->
      <div v-show="tab === 2" class="w:full">
        <nr-props-grid>
          <nr-label>Title</nr-label>
          <nr-string-input
            :modelValue="title"
            @update:modelValue="$emit('update:prop', 'title', $event)"
            tip="Text to display in the widget header. Change using `msg.title`." />

          <nr-label>Import Map</nr-label>
          <nr-kv-input
            :modelValue="import_map"
            @update:modelValue="$emit('update:prop', 'import_map', $event)"
            tip="Map of import specifier to URL for the resolution of import statements." />
        </nr-props-grid>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from "vue"

// Simple button widget to populate new empty flexdash-custom editors.
const sfc_template = `
[template>
  <v-btn variant="elevated" class="ma-auto" @click="clicked()">
    <span class="label">{{ label }}</span>
  </v-btn>
[/template>

[style scoped>
  .label { color: red; }
[/style>

[script>
exportdefault {
  // Props are the inputs to the widget.
  // They can be set dynamically using Node-RED messages using \`msg.<prop>\`.
  // In a "custom widget" like this one they cannot be set via the Node-RED flow editor:
  // use the default values in the lines below instead.
  props: {
    label: { default: "clickme" }, // text to show inside button
    output: { default: "I was clicked" }, // value to output when clicked
  },

  emits: ['send'], // declare to Vue that this component emits a 'send' event

  // simple methods within the component
  methods: {
    clicked() { // handle the clicking of the button, i.e., the handler for the '@click'
      this.$emit('send', this.output) // emit an event (Vue concept), a 'send' event goes to NR
    },
  },
}
[/script>
`.trimStart().replace(/^\[/gm, '<').replace("exportdefault", "export default")

export default defineComponent({
  name: "EditFlexdashCustom",
  props: {
    name: { type: String, required: false },
    title: { type: String, required: false },
    import_map: { type: Object, required: false },
    sfc_source: { type: String, required: false },
    // required fields for FlexDash Widget nodes
    fd_container: { default: "", config_type: "flexdash container", required: true }, // grid/panel
    fd_cols: { default: 1, type: Number }, // widget width
    fd_rows: { default: 1, type: Number }, // widget height
    fd_array: { default: false, type: Boolean }, // create array of this widget
    fd_array_max: { default: 10, type: Number }, // max array size
  },
  emits: ["update:prop"],
  data: () => ({
    tab: 0,
    blink: 1, // used to restart code editor when sfc_source is empty
  }),
  mounted() {
    // populate empty editors with a simple button widget
    if (!this.sfc_source) {
      // we inject into the code editor for which we have to restart it, sigh
      this.$emit("update:prop", "sfc_source", sfc_template)
      this.blink = 0
      this.$nextTick(() => { this.blink = 1 })
    }
  },
  methods: {
    propagate(prop, value) {
      this.$emit("update:prop", prop, value)
    },
  },
  node_red: {
    category: "flexdash",
    color: "#F0E4B8",
    inputs: 1,
    outputs: 1, // FIXME: make this dynamic
    icon: "font-awesome/fa-pen", // icon in flow editor
    paletteLabel: "FD custom",
    label() {
      const lbl = this.name || this.paletteLabel
      return this.fd_array ? lbl + "[ ]" : lbl // indicate whether this is an array-widget
    },
    labelStyle() {
      return this.name ? "node_label_italic" : ""
    },
  },
  help: `Custom widget for FlexDash.
Write a Vue component defining a custom FlexDash widget directly in the Node-RED editor.
A custom widget consists of three parts:
1. the widget source code that gets loaded into FlexDash
2. the standard FlexDash node configuration in the general tab
3. special widget configuration, including imports, in the config tab

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

## Widget source code

The source code is processed by Vue in the Node-RED server to compile it to plain javascript.
This uses the Vue SFC (Single File Component) compiler and currently requires that the component
be authored using the Vue Options API (not the Composition API).
The component further should follow the
[FlexDash conventions for widgets](https://flexdash.github.io/docs/developing-widgets/vue-extensions/).

There are some limitations to authoring custom widgets:

- There is no way to set default values for props in the Node-RED editor, however, defaults can be
set directly in the source code.
- There is no place to display help text or tips for props, however, the source code
(which can have comments!) is readily visible.
- Custom widgets cannot be reused: each node compiles and creates a distinct widget instance and
if a custom widget is duplicated in the flow editor that creates a separate copy of everything
making it painful to update the widget source code consistently across all copies.
The solution for widgets intended to be reused is to write a _custom component_ with the bulk
of the widget code, a _custom widget_ that is just a thin wrapper around the custom component,
and then to replicate just the wrapper custom widget.

## Importing libraries

FlexDash uses JavaScript modules to load dependencies (e.g. libraries).
It is possible to load libraries the old fashioned way using script tags by inserting
such tags dynamically into the DOM, but that is not recommended and leads to interesting
situations when the same or similar libraries are loaded multiple times by different widgets
(or clones of one widget).

Generally, sample code found on the internet assumes a build step. For example, a line
such as

    import Plotly from \`plotly\`

assumes that a build step resovles the name \`plotly\` to something like
\`./node_modules/plotly.js/dist/plotly.min.js\` and then further, the bundling step may
put all the code together into a single file and connect variables directly, i.e., it ends up
without anything being imported at all. This is not the case with custom widgets.

In the browser, the "from" part of an import statements can have three forms:
- the relative form where the path starts with \`./\` or \`../\` does not work for custom widgets
as there is no well-defined base path for the import,
- the absolute URL form where the path starts with \`http://\` or \`https://\` works but ends
up downloading the import every time FlexDash is loaded (except for caching in the browser),
- the plain name form, such as \`plotly\` above and which may contain slashes, works well
but requires that the import be _mapped_ in the \`import map\` configuration.

To make an import such as \`from "plotly"\` work an import map entry needs to be created that
maps the plain name used in the "from" clause to the URL where the library can be downloaded.
That URL must point to the "ES Module" version (often with "esm" in the filename) of the library,
e.g., \`plotly.esm.min.js\`.

It is recommended to actually download the library file and place it on the Node-RED server
where it can be downloaded by browsers (the static file serving of Node-RED works great for this).
This avoids depending on Internet resources that may be unavailable or slow and it speeds up the
loading of the dashboard when the Node-RED server is on the same network as the browser.

If you are having difficulties locating ESM builds of an NPM module the https://unpkg.com,
https://www.jsdelivr.com, and https://esm.sh may be of help. Ask for help on the forum...

## Linking custom components

In order to use a custom component in the custom widget the component must be linked.
The linking performs two functions: it imports the right code into the custom widget
and it establishes a dependency between the custom widget node and the custom component node
in Node-RED such that an export of the flow includes both nodes.

  `,
})
</script>
