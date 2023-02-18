<!-- FlexDash container config panel
     Copyright ©2022 by Thorsten von Eicken, see LICENSE
-->

<template>
  <nr-props-grid>
    <nr-label icon="fa fa-tag mr:1ex"> Name</nr-label>
    <nr-string-input
      :modelValue="name"
      @update:modelValue="$emit('update:prop', 'name', $event)"
      tip="Name of config node in Node-RED, not shown in dashboard." />

    <nr-label>Title</nr-label>
    <nr-string-input
      :modelValue="title"
      @update:modelValue="$emit('update:prop', 'title', $event)"
      tip="Name shown above panel or grid in dashboard. Hidden if left empty.
          Change dynamically by sending `msg.set_title` to FlexDash ctrl node." />

    <nr-label>Container type</nr-label>
    <div class="flex flex:col">
      <nr-buttonbar-input
        :modelValue="kind"
        :options="[
          ['StdGrid', 'grid'],
          ['PopupGrid', 'pop-up grid'],
          ['Panel', 'panel'],
          ['SubflowPanel', 'subflow panel'],
        ]"
        @update:modelValue="$emit('update:prop', 'kind', $event)" />
      <div class="text:85% pt:4">
        A <b>grid</b> is the primary container for widgets and panels. It displays a grid of widgets
        and panels, and reflows its content based on the width of the browser window.<br />
        A <b>pop-up grid</b> is displayed as a full-window pop-up overlay.<br />
        A <b>panel</b> can be used within a grid to create a half-sized sub-grid in which widgets
        can be arranged at fixed positions without being impacted by the window width.<br />
        A <b>subflow panel</b> is a panel that holds all widgets of a subflow, it can only be used
        with nodes in a subflow.
      </div>
    </div>

    <!-- Fields specific to grids -->
    <div v-if="isGrid" class="contents">
      <nr-label>Tab</nr-label>
      <nr-config-input
        :modelValue="tab"
        @update:modelValue="$emit('update:prop', 'tab', $event)"
        prop-name="tab"
        :configTypes="['flexdash tab']"
        tip="Tab in which the grid is shown."
        v-slot="slotProps">
        {{ format_config_node(slotProps.node) }}
      </nr-config-input>

      <nr-label>Columns</nr-label>
      <nr-input-tip
        tip="Minimum and maximum number of grid columns shown in the grid.
        This can be used to constrain the reflow based on window width.
        The values can be changed dynamically by sending `msg.min_cols` and/or `msg.max_cols`
        to a FlexDash ctrl node.">
        <div class="flex">
          <nr-label>Min</nr-label>
          <nr-number-input
            class="mx:1ex"
            :modelValue="min_cols"
            @update:modelValue="$emit('update:prop', 'min_cols', $event)" />
          <nr-label class="ml:3ex">Max</nr-label>
          <nr-number-input
            class="ml:1ex"
            :modelValue="max_cols"
            @update:modelValue="$emit('update:prop', 'max_cols', $event)" />
        </div>
      </nr-input-tip>

      <nr-label><span class="font:mono">_fd_socket</span></nr-label>
      <nr-buttonbar-input
        :modelValue="unicast || 'ignore'"
        :options="['ignore', 'allow', 'require']"
        @update:modelValue="$emit('update:prop', 'unicast', $event)"
        tip="Select how widgets in the grid should handle incoming messages
        that have `msg._fd_socket` set." />
    </div>

    <!-- Fields specific to "normal" panels -->
    <div v-else class="contents">
      <div v-if="isSubflowPanel" class="contents">
        <nr-label><i class="fa fa-warning" /></nr-label>
        <p class="mt:1ex">
          You must associate this panel with a subflow using the selector at the bottom-right
        </p>
      </div>

      <div v-else class="contents">
        <nr-label>Grid</nr-label>
        <nr-config-input
          :modelValue="parent"
          @update:modelValue="$emit('update:prop', 'parent', $event)"
          prop-name="parent"
          :configTypes="['flexdash container']"
          tip="Grid in which the panel is shown."
          v-slot="slotProps">
          {{ format_config_node(slotProps.node) }}
        </nr-config-input>
      </div>

      <nr-label>Solid</nr-label>
      <nr-checkbox-input
        :modelValue="solid"
        @update:modelValue="$emit('update:prop', 'solid', $event)"
        tip="A solid panel looks like a single widget and the widgets within it are rendered without
              borders. A non-solid panel looks like a sub-grid and the widgets it contains are
              rendered with their usual borders." />

      <nr-label>Size</nr-label>
      <nr-input-tip tip="Panel dimensions in grid units.">
        <div class="flex">
          <nr-label>Rows</nr-label>
          <nr-number-input
            class="mx:1ex"
            :modelValue="rows"
            @update:modelValue="$emit('update:prop', 'rows', $event)" />
          <nr-label class="ml:3ex">Columns</nr-label>
          <nr-number-input
            class="ml:1ex"
            :modelValue="cols"
            @update:modelValue="$emit('update:prop', 'cols', $event)" />
        </div>
      </nr-input-tip>
    </div>

    <hr class="grid-col-span:2 mt:1ex mb:0" />
    <div class="grid-col-span:2 ml:auto mt:-1ex text:85%">Node ID: {{ node.id }}</div>
  </nr-props-grid>
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
    min_cols: { default: 1, type: Number }, // validate(v) { return (v>0 && v<=20) } },
    max_cols: { default: 20, type: Number }, // validate(v) { return (v>0 && v<=20) } },
    unicast: { default: "ignore" },
    // params for panels
    parent: { default: "", config_type: "flexdash container", required: false },
    solid: { default: false, type: Boolean },
    cols: { default: 1, type: Number }, // validate(v) { return v > 0 && v <= 20 },
    rows: { default: 1, type: Number }, // validate(v) { return v > 0 && v <= 100 },
  },
  inject: ["node"], // to display the id...
  emits: ["update:prop"],

  computed: {
    isGrid() {
      return this.kind.endsWith("Grid")
    },
    isSubflowPanel() {
      return this.kind == "SubflowPanel"
    },
  },
  methods: {
    format_config_node(node) {
      return node?.name || node?.title || node?.icon || ""
    },
  },
})
</script>
