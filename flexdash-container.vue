<!-- FlexDash container node for Node-RED
     Copyright ©2022 by Thorsten von Eicken, see LICENSE
-->

<template>
  <nr-tabs :tabs="['Config', 'Contents']" v-model="uitab" v-bind="$attrs" />
  <fd-container-config v-show="uitab === 0" v-bind="$props" @update:prop="onUpdateProp" />
  <fd-grid-sorter
    v-show="uitab === 1"
    :items="fd_children.substring(1).split(',')"
    @update:items="onItems"
    @update:itemSize="onItemSize" />
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  name: "EditFlexdashContainer",
  props: {
    name: { type: String, required: false },
    title: { type: String, required: false },
    kind: { default: "StdGrid" },
    fd_children: { default: "" }, // comma-separated list of child node IDs
    // params for grids
    tab: { default: "", config_type: "flexdash tab", required: false },
    // validate(v) {
    //   if (!is_a(this, "Grid")) return true
    //   const configNode = RED.nodes.node(v)
    //   return configNode && (configNode.valid == null || configNode.valid)
    // }
    min_cols: { default: 1, type: Number }, // validate(v) { return (v>0 && v<=20) } },
    max_cols: { default: 20, type: Number }, // validate(v) { return (v>0 && v<=20) } },
    unicast: { default: "ignore" },
    // can't validate due to pre-existing nodes, stupid NR that doesn't have migrations
    //validate(v) { return ['ignore','disallow','allow','require'].includes(v) }
    // params for panels
    parent: { default: "", config_type: "flexdash container", required: false },
    // validate(v) {
    //   // validate gets ID string
    //   if (!is_a(this, "Panel") || is_a(this, "SubflowPanel")) return true
    //   const configNode = RED.nodes.node(v)
    //   const parent_is_panel = configNode?.kind?.endsWith("Panel")
    //   return configNode && (configNode.valid == null || configNode.valid) && !parent_is_panel
    // },
    // filter(c) {                      FIXME: need to support this!
    //   // filter gets object
    //   return c.kind?.endsWith("Grid")
    // },
    solid: { default: false, type: Boolean },
    cols: { default: 1, type: Number }, // validate(v) { return v > 0 && v <= 20 },
    rows: { default: 1, type: Number }, // validate(v) { return v > 0 && v <= 100 },
  },

  inject: ["$bus"],
  emits: ["update:prop"],

  data() {
    return {
      uitab: 0,
      widgetChanges: [], // array of changes to be saved
    }
  },

  mounted() {
    // subscribe to save events
    this.$bus.on("save", () => this.onSave())
  },

  compute: {
    isGrid() {
      return this.kind.endsWith("Grid")
    },
  },

  methods: {
    // handle prop update in config tab
    onUpdateProp(prop, value) {
      this.$emit("update:prop", prop, value)
    },
    // handle reordering events from the grid sorter, convert array to string representation
    onItems(items) {
      this.$emit("update:prop", "fd_children", "," + items.join(","))
    },
    // handle resize events from the grid sorter, like (id, "rows", 3)
    onItemSize(id, what, value) {
      this.widgetChanges.push({ id, what, value })
    },
    // handle save button, save all widget changes
    onSave() {
      this.widgetChanges.forEach(({ id, what, value }) => {
        const n = RED.nodes.node(id)
        if (n) {
          if (what in n) n[what] = value
          else if ("fd_" + what in n) n["fd_" + what] = value
          else return
          n.changed = true // mark node as changed
          RED.nodes.dirty() // mark project as changed
          RED.events.emit("nodes:change", n)
        }
      })
      this.widgetChanges = []
    },
  },

  node_red: {
    category: "config",
    color: "#F0E4B8",
    label() {
      return this.name || this.kind
    },
    labelStyle() {
      return this.name ? "node_label_italic" : ""
    },
  },
  help: `A grid or panel in FlexDash.

Grids and Panels in FlexDash hold widgets in a grid layout.
For general help on grids and panels refer to the documentation for
[core concepts](https://flexdash.github.io/docs/using-flexdash/core-concepts/)
around page layout as well as specifics of
[grid and panel layout](https://flexdash.github.io/docs/using-flexdash/grid-panel-layout/)

In the \`config\` tab various properties of the grid or panel can be set.
In the \`contents\` tab the widgets that are contained in the grid or panel can be
rearranged and resized.

## Contents tab

The \`contents\` tab shows a preview of the grid layout with each widget having its
configured size and its content replaced by a label (the widget name or title or ID).
A \`#1\` sequence number in the bottom left of each widget shows the order in which
the widgets are placed in the grid.

### Reordering widgets

The order can be changed by dragging a widget onto another one, which it then replaces.
(If a widget is dragged onto an earlier widget, it will be placed before that widget,
if a widget is dragged onto a later widget, it will be placed after that widget because
the target widget moves up one spot.)
Dragging a widget onto the first widget will make it first in the grid and dragging it
onto the last widget (by #number) will make it last in the grid.

The grid in FlexDash is configured to "auto-fill" empty spaces:
when there are empty spaces in the layout caused by large widgets then _later_
small widgets are automatically moved up to fill those spaces.
This tends to make for nicer layouts but it can make reordering unpredictable.
The auto-fill behavior can be disabled _for this preview only_ 
using the \`auto-fill\` checkbox.
(Providing this option also on the real grid is planned.)

### Resizing widgets

Once a widget has been selected, its size can be changed using the rows/cols controls
at the top of the tab.

### Preview scaling

The intent of the preview scaling is to be able to simulate the layout as it might be
shown on devices with various screen sizes.
To enable this, the preview shows the grid layout as it would be rendered in a browser
window of a specific size and the view is scaled to fit the editing pane width.

The width of the simulated window can be changed by selecting the number of grid
columns to accomodate.
For example, selecting 6 columns results in a simulated window of 768 pixels width,
which is the minimum width that accomodates 6 columns.
Selecting 7 columns results in a simulated width of 896 pixels.
Widths in-between cannot be set, but are not very interesting because they simply
result in a slight stretch of the 6-column layout.

The minimum number of grid columns that can be selected is the number of
columns occupied by the widest widget in the grid.
This is also a restriction of the real grid.

Resizing the editing panel does not change the width of the simulated window:
it only changes the scaling factor to make the simulated window fit the editing pane.
`,
})

// // help button in top tray bar - thanks Kevin!
// $(
//   '<button type="button" class="ui-button ui-corner-all ui-widget">' +
//     '<i class="fa fa-book"></i> help</button>'
// )
//   .on("click", () => {
//     RED.sidebar.help.show(this.type)
//   })
//   .insertBefore($("#node-config-dialog-cancel"))
// console.log("FlexDash container prepare", this)
</script>
