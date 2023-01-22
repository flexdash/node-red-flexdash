<!-- FlexDash Grid Sorter - Implements drag&drop sorting and resizing of widgets in a grid.
     Copyright ©2023 by Thorsten von Eicken, see LICENSE
-->
<template>
  <div ref="outer">
    <!-- Component info with resizing controls -->
    <div class="flex mb:1ex">
      <!--div :class="`r:4 p:4 bg:${dragging ? 'blue-80' : 'gray-80'}`">dragging</div -->
      <div class="w:full h:32 flex align-items:center justify-content:stretch">
        <div class="mr:2ex">Selected:</div>
        <div v-if="dragged" class="display:contents">
          <div
            :class="[
              'w:20ex p:0.5ex r:4 bg:gray-90',
              'flex-grow:1 white-space:nowrap text:ellipsis overflow:hidden',
            ]">
            {{ dragged.label }}
          </div>

          <div class="ml:3ex mr:1ex">rows:</div>
          <nr-number-input
            :modelValue="Number(dragged.rows)"
            @update:modelValue="setRC(dragged.id, 'rows', $event)" />

          <div class="ml:3ex mr:1ex">cols:</div>
          <nr-number-input
            :modelValue="Number(dragged.cols)"
            @update:modelValue="setRC(dragged.id, 'cols', $event)" />
        </div>
      </div>
    </div>

    <!-- Controls for the scaling of the grid to simulate various browser window widths -->
    <div class="mb:1ex w:full h:32 flex align-items:center justify-content:start">
      <div>Grid columns:</div>
      <nr-buttonbar-input v-model="windowCols" :options="gridColOptions" class="mx:1ex" />
    </div>

    <!-- info about the selected size, help button, and auto-fill toggle -->
    <div class="mb:1ex w:full h:32 flex align-items:center justify-content:start">
      <div>Simulated window width:</div>
      <div class="p:0.75ex mx:1ex r:4 bg:gray-90">{{ windowWidth-2 }}px</div>
      <div class="">(scale: {{ gridScale.toFixed(2) }}x)</div>
      <button class="mx:auto px:1ex py:0.5ex r:4 b:solid|1|gray-78" @click="openHelp">
        <i class="fa fa-book"></i> help
      </button>
      <nr-checkbox-input class="mr:0.5ex mt:0_* accent:gray-90" v-model="autoFill" />
      <div>auto-fill</div>
    </div>

    <!-- The grid -->
    <div
      ref="grid"
      :class="[
        'grid grid-template-cols:repeat(auto-fill,minmax(120px,1fr))',
        `grid-auto-rows:79px gap:8px grid-auto-flow:${autoFill ? 'dense' : 'row'}`,
        'rel cursor:grabbing user-select:none touch-action:none',
        'bg:gray-98 b:1|solid|gray-70 p:4px r:4',
        'transform-origin:0|0',
        `w:${windowWidth}px scale(${gridScale.toFixed(3)})`,
      ]"
      @pointerdown.prevent="mousedown"
      @pointermove="mousemove"
      @pointerup="mouseup">
      <fd-grid-sorter-item
        v-for="c in components"
        key="c.id"
        v-bind="c"
        :c-id="c.id"
        :class="[
          { 'bg:gray-80! fg:gray-50!': c.dragged },
          { 'bg:yellow-90!': c.selected },
          'draggable',
        ]" />

      <!-- Dragged item floating above the grid -->
      <div
        :class="[
          'abs flex z:10 opacity:0.8',
          `top:${top} left:${left} w:${dragBB.w} h:${dragBB.h}`,
          'pointer-events:none',
        ]"
        v-if="dragging">
        <fd-grid-sorter-item v-bind="dragged" class="bg:yellow-90!" />
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from "vue"

const COLW = 120 // width of a grid column
const GAPW = 8

export default defineComponent({
  props: {
    items: { type: Array, required: true }, // initial list of Node-RED node IDs
  },
  emits: ["update:items", "update:itemSize"],
  data() {
    return {
      reordered: this.items, // potentially reordered list of Node-RED node IDs
      itemSizes: {}, // map of Node-RED node IDs to { rows, cols } for resized items
      dragging: false, // currently dragging an item around
      top: 0, // top/left of dragged item, relative to grid origin
      left: 0,
      draggedId: null, // Node-RED node ID of the item being dragged
      dragBB: { x: 0, y: 0, w: 120, h: 80 }, // offset in component and its dim on drag-start
      // variable for stationary mouse detection
      lastMouseX: 0, // last mouse position
      lastMouseY: 0,
      lastMouseAt: 0, // timestamp of last mouse position
      // scaling of the grid to simulate window widths
      windowCols: 6,
      outerWidth: 500, // DOM width of the grid's container, i.e., el.clientWidth
      outerObserver: null,
      autoFill: true, // whether the gri auto-fills smaller items
    }
  },
  computed: {
    // component info about each item
    components() {
      return this.reordered.map((i, ix) => {
        let ret = { id: i, ix, label: i, cols: 1, rows: 1 }
        const n = RED.nodes.node(i)
        if (n) {
          ret.label = n.name || n.title || n.id
          ret.cols = this.itemSizes[i]?.cols || n.fd_cols || n.cols || 1
          ret.rows = this.itemSizes[i]?.rows || n.fd_rows || n.rows || 1
          ret.dragged = this.dragging && i == this.draggedId // the one being dragged
          ret.selected = !this.dragging && i == this.draggedId // select the last one dragged
        }
        return ret
      })
    },
    // component info about dragged item
    dragged() {
      return this.componentById(this.draggedId)
    },
    // width of simulated window in pixels given number of desired grid columns
    windowWidth() {
      const cols = Math.max(1, Math.min(20, this.windowCols))
      return cols * (COLW + GAPW) + 2 // +2 due to border width
    },
    gridScale() {
      return this.outerWidth / this.windowWidth
    },
    // minimum num grid columns = max(component.cols)
    minCols() {
      return Math.max(1, ...this.components.map(c => c.cols))
    },
    gridColOptions() {
      return Array(12)
        .fill(0)
        .map((_, ix) => ix + this.minCols)
    },
  },

  mounted() {
    this.outerWidth = this.$refs.outer.clientWidth
    this.outerObserver = new ResizeObserver(() => {
      this.outerWidth = this.$refs.outer.clientWidth
    })
    this.outerObserver.observe(this.$refs.outer)
  },
  unmounted() {
    if (this.outerObserver) this.outerObserver.disconnect()
  },

  methods: {
    mousedown(e) {
      if (!e.isPrimary) return
      this.$refs.grid.setPointerCapture(e.pointerId)
      if (this.identifyDraggable(e)) {
        this.dragging = true
        this.$nextTick(() => this.mousemove(e)) // let computed props update
      }
    },
    mouseup(e) {
      this.dragging = false
      this.$emit("update:items", this.reordered)
    },
    mousemove(e) {
      this.lastMove = Date.now()
      if (this.dragging) {
        // make the dragged item follow the mouse
        const gridBB = this.$refs.grid.getBoundingClientRect()
        this.top = Math.round((e.clientY - gridBB.top - this.dragBB.y) / this.gridScale)
        this.left = Math.round((e.clientX - gridBB.left - this.dragBB.x) / this.gridScale)
        // when the mouse is stationary, try to reorder the components
        this.onStationaryMouse(e, newE => {
          // figure out which component we're over
          const overC = this.identifyOver(newE)
          if (!overC) return
          if (overC.id == this.dragged.id) return
          // insert dragged component before/after the one we're over
          this.displace(overC)
        })
      }
    },
    // displace component c with the dragged component
    displace(c) {
      const tgtIx = c.ix
      const srcIx = this.dragged.ix
      const me = this.reordered[srcIx]
      this.reordered.splice(srcIx, 1)
      this.reordered.splice(tgtIx, 0, me)
    },
    // identify the element under the mouse and set dragging state
    identifyDraggable(e) {
      const el = e.target.closest(".draggable")
      if (el) {
        this.draggedId = el.getAttribute("c-id")
        this.dragBB = {
          x: e.clientX - el.getBoundingClientRect().left,
          y: e.clientY - el.getBoundingClientRect().top,
          w: el.getBoundingClientRect().width / this.gridScale,
          h: el.getBoundingClientRect().height / this.gridScale,
        }
        console.log("Start dragging", el, this.dragBB)
      }
      return el
    },
    // identify which component the mouse is over during dragging
    identifyOver(e) {
      const tgt = document.elementFromPoint(e.clientX, e.clientY)
      const el = tgt.closest(".draggable")
      if (!el) return null
      const id = el.getAttribute("c-id")
      return this.componentById(id)
    },
    // return component by ID
    componentById(id) {
      return this.components.find(c => c.id == id)
    },
    // call handler when the mouse has been stationary for a while
    onStationaryMouse(e, handler) {
      if (Math.abs(e.pageX - this.lastMouseX) > 20 || Math.abs(e.pageY - this.lastMouseY) > 20) {
        this.lastMouseX = e.pageX
        this.lastMouseY = e.pageY
        this.lastMouseAt = Date.now()
        if (this.stationaryTimeout) clearTimeout(this.stationaryTimeout)
        this.stationaryTimeout = setTimeout(() => handler(e), 600)
        return false
      }
    },
    // update the size of a component
    setRC(id, what, value) {
      this.$emit("update:itemSize", id, what, value)
      if (!(id in this.itemSizes)) this.itemSizes[id] = {}
      this.itemSizes[id][what] = value
    },
    // open help sidebar
    openHelp() {
      RED.sidebar.help.show("flexdash container")
    },
  },
})
</script>
