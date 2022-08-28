// color picker for Node-RED flow editor. This picker differs from the one built into NR in
// that it expects a color definition as found in Vuetify's material design color palette and
// in that it return the name of the color instead of a hex value.
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

let curVariant = '3' // remember selected variant globally

export class ColorPicker {
    // the constructor expects the current element, a color palette, and the current color value
    // the palette is a map of color names to color variant objects, each color variant object is
    // a map from the variant name to the hex value. The variants must be 'base' or end in a
    // digit, such as lighten1, lighten2, etc.
    constructor(el, palette, value) {
        //console.log('colorPicker for', el, 'with color', value)
        this.el = el
        this.palette = palette
        this.color = value
        this.closedAt = 0

        // overall button to open/close color picker
        this.colorButton = $('<button type="button" class="red-ui-button red-ui-editor-node-appearance-button">')
        $('<i class="fa fa-caret-down"></i>').appendTo(this.colorButton)
        this.colorButton.css({'margin-right': '4px'})
        el.before(this.colorButton)
        el.css({width:'15em'})

        // color swatch within color button
        const colorSwatchContainer = $('<div>',{class:"red-ui-search-result-node"}).appendTo(this.colorButton)
        $('<div>',{class:"red-ui-color-picker-cell-none"}).appendTo(colorSwatchContainer)
        this.colorSwatch = $('<div>',{class:"red-ui-color-picker-swatch"}).appendTo(colorSwatchContainer)

        this.colorButton.on('click', () => this.onClick())
    }

    // return the hex value of the color or null if not found
    colorByName(name) {
        if (!name || typeof name !== 'string') return ""
        // first match the base color name, i.e. prefix
        let variants
        for (let c in this.palette) {
            const cs = this.colorSnake(c)
            if (name.startsWith(cs)) {
                variants = this.palette[c]
                name = name.substring(cs.length)
                if (name.length === 0 && variants.hasOwnProperty('base')) {
                    return variants['base']
                } else if (name[0] === '-') {
                    name = name.substring(1)
                }
                break
            }
        }
        // if not found assume it's a shade for now (black, white, transparent)
        if (!variants) variants = this.palette['shades']
        // then match the variant name
        for (let v in variants) {
            if (v === name) {
                return variants[v]
            }
        }
        return null
    }

    colorSnake(name) { return name.replace(/([A-Z])/g, '-$1').toLowerCase() }

    // given the color and variant palette keys return the dasherized name
    colorName(color, variant) {
        if (color == 'shades') return variant
        color = this.colorSnake(color)
        if (variant === 'base') return color
        return color + '-' + variant
    }

    refreshDisplay() {
        const hex = this.color && this.color[0] == '#' ? hex : this.colorByName(this.color)
        if (hex) {
            this.colorSwatch.removeClass('red-ui-color-picker-cell-none').css({
                "background-color": hex,
            })
            let border = RED.utils.getDarkerColor(this.color)
            if (border[0] === '#') {
                border += Math.round(255*Math.floor(opacity*100)/100).toString(16)
            } else {
                border = ""
            }
            this.colorSwatch.css({
                "border-color": border
            })
            this.el.val(this.color)
        } else {
            this.colorSwatch.addClass('red-ui-color-picker-cell-none').css({
                "background-color": "",
            })
            this.colorSwatch.css({
                "border-color":""
            })
            this.el.val("")
        }
    }

    // when the button is clicked show or remove the color picker
    onClick() {
        // hack: when clicking the button while the panel is open the panel closes itself due
        // to click-outside and then the button gets the click and reopens the panel. We fix
        // this by ignoring a click within 100ms of the panel closing.
        //if (!this.closedAt || Date.now()-this.closedAt > 100) this.showPanel()
        this.showPanel()
    }

    showPanel() {
        let focusTarget // swatch of current color

        const picker = $("<div/>").css({
            display: 'flex', flexDirection: 'column',
            padding: '8px', 'max-width': '500px',
        })
        // title at top of picker
        const title = $('<div><span>FlexDash Material Design Colors</span></div>').css({
            display: 'flex', margin: '0px 4px 0px 4px',
            fontSize: '120%',
        })
        title.appendTo(picker)
        // on-hover display of currently hovered color name
        const hover = $('<span />').css({
            marginLeft: 'auto',
        })
        hover.appendTo(title)

        // buttons to select the variant
        const variantBar = $('<div>').css({
            display: 'flex', alignItems: 'baseline', justifyContent: 'center',
            margin: '8px 4px', padding: '4px 4px',
            backgroundColor: '#f0f0f0',
        })
        $('<span>Variants:</span>').appendTo(variantBar)
        for (let v=1; v<6; v++) {
            $(`<div>-${v}</div>`).css({
                margin: '0 4px', padding: '4px 4px 0px 4px',
                borderRadius: '3px', border: '1px solid #888', 
                backgroundColor: v == curVariant ? '#bbb' : '#fff',
                cursor: 'pointer',
            }).on('click', () => {
                curVariant = v
                this.colorPanel?.hide(true)
                this.showPanel()
            }).appendTo(variantBar)
        }
        variantBar.appendTo(picker)

        // main part of picker with all color swatches
        const swatches = $('<div>').css({
            display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
        })
        swatches.appendTo(picker)

        // the swatches are a left-to-right wrapping set of vertical boxes, one for each color
        // within each of these there are up to 4 swatches for 4 variants arranged vertically
        for (let color in this.palette) {
            const colorBox = $("<div/>").css({
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                margin: "4px 4px",
            })
            // put the name of the color at the top
            const c = this.colorSnake(color)
            $(`<div>${c}</div>`).css({
                margin: "0px -10px", // hack to deal with over-long names
            }).appendTo(colorBox)
            // add the variants below
            const cv = `${curVariant}`
            const vv = color != 'shades' ? ['lighten-'+cv, 'base', 'accent-'+cv, 'darken-'+cv]
                                         : Object.keys(this.palette[color])
            for (let variant of vv) {
                if (!(variant in this.palette[color])) continue
                const name = this.colorName(color, variant)
                const colorCell = $("<div/>").css({
                    width: '50px', height: '20px', margin: '3px 0px',
                    backgroundColor: this.palette[color][variant],
                    borderRadius: '3px', border: '2px solid #0000',
                    cursor: 'pointer',
                })
                if (color == 'shades') colorCell.css({border: '1px solid #666'})
                colorCell.hover(() => hover.text(name), () => hover.text(''))
                colorCell.on('click', () => {
                    this.color = name
                    this.refreshDisplay()
                    picker.remove()
                }).appendTo(colorBox)
                if (name == this.color) focusTarget = colorCell
            }
            colorBox.appendTo(swatches)
        }

        this.colorPanel = RED.popover.panel(picker)
        this.colorPanel.show({
            target: this.colorButton,
            offset: [0, 2],
            closeButton: this.colorButton,
            onclose: () => {
                this.colorButton.focus()
                this.closedAt = Date.now()
                this.colorPanel = null
            }
        })

        if (focusTarget) focusTarget.css({border: '2px solid #666'}).focus()
    }

}

export default function(...args) {
    const cp = new ColorPicker(...args)
    setTimeout(() => cp.refreshDisplay(), 50) // ???
    return cp
}
