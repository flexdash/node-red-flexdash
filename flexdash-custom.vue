<template>
  <div class="h:full">
    <div class="flex flex:col h:full">
      <nr-tabs :tabs="['General', 'Widget code', 'Config']" v-model="tab" />
      <!-- General tab -->
      <fd-general-tab v-show="tab === 0" @update:prop="propagate" />"

      <!-- Widget Code tab -->
      <nr-code-editor
        v-show="tab === 1"
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
  help: "No help yet, \"'sorry'\"...",
})
</script>
