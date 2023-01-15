<template>
  <div
    :class="[
      'bg:white r:8 p:4 w:full h:full shadow:2|4|gray-88',
      'rel flex flex:col justify-content:center align-items:center',
      `grid-row-span:${rows} grid-col-span:${cols}`,
    ]">
    <div class="text-align:center">{{ label }}</div>
    <div class="abs bottom:-0.5ex left:0.5ex font-size:85% fg:gray-60">#{{ ix + 1 }}</div>
  </div>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  props: {
    id: "",
    ix: "",
    label: "",
    rows: 1,
    cols: 1,
  },
})
</script>
