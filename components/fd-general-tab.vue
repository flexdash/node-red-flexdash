<template>
  <nr-props-grid>
    <nr-label icon="fa fa-tag mr:1ex"> Name</nr-label>
    <nr-string-input
      :modelValue="node.name"
      @update:modelValue="$emit('update:prop', 'name', $event)"
      tip="Name of node in Node-RED, not shown in dashboard." />

    <nr-label>Container</nr-label>
    <nr-config-input
      :modelValue="node.fd_container"
      @update:modelValue="$emit('update:prop', 'fd_container', $event)"
      prop-name="fd_container"
      :configTypes="['flexdash container']"
      tip="Dashboard Grid or Panel in which widget is shown."
      v-slot="slotProps">
      {{ format_config_node(slotProps.node) }}
    </nr-config-input>

    <nr-label>Size</nr-label>
    <nr-input-tip tip="Widget dimensions in grid units.">
      <div class="flex">
        <nr-label>Rows</nr-label>
        <nr-number-input
          class="mx:1ex"
          :modelValue="Number(node.fd_rows)"
          @update:modelValue="$emit('update:prop', 'fd_rows', $event)" />
        <nr-label class="ml:3ex">Columns</nr-label>
        <nr-number-input
          class="ml:1ex"
          :modelValue="Number(node.fd_cols)"
          @update:modelValue="$emit('update:prop', 'fd_cols', $event)" />
      </div>
    </nr-input-tip>

    <hr class="grid-col-span:2 my:1ex" />

    <nr-label>Widget Array</nr-label>
    <nr-checkbox-input
      :modelValue="node.fd_array"
      @update:modelValue="$emit('update:prop', 'fd_array', $event)"
      tip="Generate an array of widgets based on distinct msg.topic values." />

    <nr-label>Max widgets</nr-label>
    <nr-number-input
      :modelValue="Number(node.fd_array_max)"
      @update:modelValue="$emit('update:prop', 'fd_array_max', $event)"
      tip="Prevent run-away arrays by limiting the max number of widgets generated." />

    <hr class="grid-col-span:2 my:1ex" />

    <nr-label>Output topic</nr-label>
    <nr-string-input
      v-if="!node.editedProp('fd_array')"
      :modelValue="node.output_topic"
      @update:modelValue="$emit('update:prop', 'output_topic', $event)"
      tip="Optional string to output in `msg.topic`" />
    <div v-else class="mt:1ex">
      <span class="font-mono text-yellow-900">msg.topic</span>
      is set to the topic of the array element producing the message.
    </div>

    <nr-label>Loopback</nr-label>
    <nr-checkbox-input
      :modelValue="node.fd_loopback"
      @update:modelValue="$emit('update:prop', 'fd_loopback', $event)"
      tip="Loop `msg.payload` node output back to its input." />

    <hr class="grid-col-span:2 mt:1ex mb:0" />
    <div class="grid-col-span:2 ml:auto mt:-1ex text:85%">Node ID: {{ node.id }}</div>
  </nr-props-grid>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  name: "FdGeneralTab",
  emits: ["update:prop"],
  inject: ["node"],
  data() {
    return {
      props: {},
    }
  },
  methods: {
    format_config_node(node) {
      const kind = node.kind || node.type
      const name = node.name || node.id
      return `${name} (${kind})`
    },
  },
})
</script>
