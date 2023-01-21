<!-- Format a node's label for a drop-down list of config nodes
     Copyright ©2023 by Thorsten von Eicken, see LICENSE
-->
<template>
  <div>{{ label }}</div>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  name: "FdFmtNodeLabel",
  props: {
    node: { type: Object, required: true },
  },
  computed: {
    label() {
      return this.node._def.label.apply(this.node)
    },
  },
})
</script>
