<!-- FlexDash List Sorter - Implements drag&drop sorting and resizing of a list.
     Copyright ©2023 by Thorsten von Eicken, see LICENSE
-->
<template>
  <div>
    <div
      ref="list"
      :class="[
        'flex flex:col align-items:stretch',
        'rel cursor:grabbing user-select:none touch-action:none',
        'bg:gray-98 b:1|solid|gray-70 p:4px r:4',
      ]"
      @pointerdown.prevent="mousedown"
      @pointermove="mousemove"
      @pointerup="mouseup">
      <div
        v-for="ix in order"
        :ix="ix"
        :key="ix"
        :class="[
          'w:full bg:white draggable',
          ix == draggedIx ? `rel z:10 top:${top} pointer-events:none bg:yellow-90>*` : 'bg:white',
        ]">
        <slot :item="items[ix]" />
      </div>

      <!-- Dragged item floating above the list -->
      <!--div
        :class="['abs flex z:10 opacity:0.8', `top:${top}`, 'pointer-events:none']"
        v-if="dragging">
        <slot v-bind="dragged" class="bg:yellow-90!" />
      </div-->
    </div>
  </div>
</template>

<script>
import { defineComponent } from "vue"

export default defineComponent({
  props: {
    items: { type: Array, required: true }, // initial list of
  },
  emits: ["update:items"],
  data() {
    return {
      order: this.items.map((_, ix) => ix), // order of items
      draggedIx: null, // string! index of the item being dragged **in items**
      draggedEl: null, // the element being dragged
      // mouse position tracking for dragging
      top: 0, // top of dragged item
      mouseDownY: 0, // mouse position on mousedown
      origOffsetTop: 0, // offsetTop of draggedEl on mousedown
      minY: 0, // min top position of dragged item
      maxY: 0, // max top position of dragged item
    }
  },

  methods: {
    mousedown(e) {
      if (!e.isPrimary) return
      this.$refs.list.setPointerCapture(e.pointerId)
      const el = e.target.closest(".draggable") // identify draggable el under mouse
      if (el) {
        this.draggedIx = el.getAttribute("ix")
        this.draggedEl = el
        this.origOffsetTop = el.offsetTop
        this.top = 0
        this.mouseDownY = e.clientY
        this.minY = 4
        const parent = el.offsetParent
        this.maxY = parent.offsetHeight - el.offsetHeight - 4
      } else {
        this.draggedIx = null
      }
    },
    mouseup(e) {
      this.draggedIx = null
      this.$emit(
        "update:items",
        this.order.map(ix => this.items[ix])
      )
    },
    mousemove(e) {
      if (this.draggedIx != null) {
        const dy = e.clientY - this.mouseDownY
        let tgtOffsetTop = this.origOffsetTop + dy
        tgtOffsetTop = Math.max(this.minY, Math.min(this.maxY, tgtOffsetTop))
        this.top += tgtOffsetTop - this.draggedEl.offsetTop
        // see what we're over
        const tgt = document.elementFromPoint(e.clientX, e.clientY)
        const overEl = tgt.closest(".draggable")
        if (overEl && overEl != this.draggedEl) {
          this.displace(overEl)
          // adjust top due to the "regular flow" position changing
          this.$nextTick(() => {
            const error = tgtOffsetTop - this.draggedEl.offsetTop
            this.top += error
          })
        }
      }
    },
    // displace component c with the dragged component
    displace(overEl) {
      const overIx = overEl?.getAttribute("ix")
      const tgt = this.order.indexOf(Number(overIx))
      const src = this.order.indexOf(Number(this.draggedIx))
      this.order.splice(src, 1)
      this.order.splice(tgt, 0, Number(this.draggedIx))
    },
  },
})
</script>
