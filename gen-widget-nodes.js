// Generate Node-RED node code for a widget
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

const fs = require('fs')
const path = require('path')
const parseVueSFC = require('./parse-vue-sfc.js')

const propTMPL = `
<div class="form-row">
    <label for="node-input-##name##">##name_text##</label>
    <input type="text" id="node-input-##name##" class="fd-typed-input" placeholder="##default_html##" />
    <input type="hidden" id="node-input-##name##-type" />
    <br><small class="fd-indent">##tip##Change using <tt>msg.##msg_name##</tt>.</small>
</div>
`.trim()

// map from types coming out of the props to what the NR typedInput understands
const typeMap = {
  'number': 'num', 'string': 'str', 'boolean': 'bool', 'object': 'json', 'array': 'json',
}

function camel2text(camel) {
  camel = camel.replace(/([a-z])([A-Z])/g, m => m[0] + ' ' + m[1])
  return camel.charAt(0).toLocaleUpperCase() + camel.slice(1)
}

function snake2text(camel) {
  camel = camel.replace(/_([a-z])/g, m => ' ' + m[1].toLocaleUpperCase())
  return camel.charAt(0).toLocaleUpperCase() + camel.slice(1)
}

function camel2kebab(camel) {
  return camel.replace(/([a-z])([A-Z])/g, m => m[0] + '-' + m[1]).toLocaleLowerCase()
}  

function generate(text, info) {
  return text.replace(/##([a-zA-Z0-9_]+)##/g, (m, p) => {
    if (!(p in info)) return m
    if (typeof info[p] === 'object') return JSON.stringify(info[p], null, 2)
    else return info[p]
  })
}

class FDWidgetCodeGen {
  
  constructor(vue_file, module_dir, custom_dir, module_name) {
    this.info = {
      vue_file: vue_file,
      base_filename: path.basename(vue_file, '.vue'),
      module_dir: module_dir,
      module_name: module_name,
      resources_dir: path.join(module_dir, 'resources'), // filesystem directory
      resources_path: `resources/${module_name}`, // URL path
    }
    this.custom_dir = custom_dir
  }  

  async parseSource() {
    try {
      const source = await fs.promises.readFile(this.info.vue_file, 'utf8')
      this.widget = parseVueSFC(source)
    } catch (e) {
      throw new Error(`Error parsing ${this.info.vue_file}: ${e.message}`)
    }  
  }  


  parseWidget() {
    if (!this.widget) return
    const props = this.widget.props
    Object.assign(this.info, {
      name: this.widget.name,
      name_text: camel2text(this.widget.name),
      type_kebab: "fd-" + camel2kebab(this.widget.name),
      help: this.widget.help,
    })  


    // parse help into title and body and produce html version
    const help = this.widget.help || 'FlexDash widget\n'
    const m = help.match(/^([^\n.!]+)(.*)$/s)
    this.info.help_title = m && m[1].trim() || 'FlexDash widget'
    let body = m && m[2].trim() || ""
    if (body.startsWith('.') || body.startsWith('!')) body = body.slice(1).trim()
    if (!body) body = "<i>(There is no help text in the widget's help property :-( .)</i>"
    // turn \n\n into paragraph boundary and `...` into fixed-width font
    this.info.help_body = body

    // parse output
    this.info.output = !!this.widget.output // boolean whether there's an output or not

    // parse props
    this.info.props = {
      title: {
        name: 'title', name_text: 'Title', name_kebab: 'title', msg_name: 'title',
        type: 'string', input_type: 'str',
        tip: 'Text to display in the widget header. ',
        default: this.info.name_text, default_html: `'${this.info.name_text}'`,
      },
      popup_info: {
        name: 'popup_info', name_text: 'Popup Info', name_kebab: 'popup-info',
        msg_name: 'popup_info', type: 'string', input_type: 'str',
        tip: 'Info text to display in (i) pop-up. ',
        default: null, default_html: null,
      }
    }
    for (const prop in props) {
      if (prop === 'title') continue
      const p = {}

      p.name = p.msg_name = prop
      p.name_text = snake2text(camel2text(prop)) // could be either...
      p.name_kebab = camel2kebab(prop).replace(/_/g, '-')
      // handle 'msg.payload': FlexDash doesn't use payload, but we map msg.payload into one
      // of a couple of hard-coded props. This should really be configurable...
      if (['value', 'data', 'text'].includes(prop)  && !this.info.payload_prop) {
        p.name_text = 'Payload'
        p.msg_name = 'payload' // name expected in incoming msg
        this.info.payload_prop = prop
      }

      // handle `props: { min: 100 }` and `props: { min: null }` cases
      if (props[prop] === null || typeof props[prop] !== 'object') {
        props[prop] = { default: props[prop] }
      }  

      // tip
      let tip = props[prop].tip?.trim() || ''
      if (tip) {
        if (!tip.match(/[.!?]$/)) tip += '.'
        tip = tip.charAt(0).toLocaleUpperCase() + tip.slice(1) + ' '
      }  
      p.tip = tip

      // default
      let def = props[prop].default
      if (typeof def === 'function') def = def() // FIXME: security risk
      p.default = (def !== undefined) ? def : null
      if (def === undefined || def === null)
        p.default_html = null
      else if (typeof def === 'object')
        p.default_html = JSON.stringify(def).replace(/"/g, "'")
      else
        p.default_html = def.toString()

      // type
      let type = props[prop].type
      if (type && 'name' in type) type = type['name'].toLowerCase()
      //if (!type && props[prop].default) type = typeof props[prop].default
      p.type = type
      p.input_type = type && typeMap[type] || "any" // for typedInput field

      this.info.props[p.name] = p
    }

  }

  async doit() {
    console.log(`Generating code for ${this.info.vue_file}`)
    await this.parseSource()
    this.parseWidget()

    // custom handlers
    const custom_file = path.join(this.custom_dir, this.info.base_filename + '.js')
    if (fs.existsSync(custom_file)) {
      this.info.custom_handlers = await fs.promises.readFile(custom_file, 'utf8')
    } else {
      this.info.custom_handlers = ""
    }

    // create resources subdir
    const resources_dir = this.info.resources_dir
    try { await fs.promises.mkdir(resources_dir) } catch (e) {}
    
    // generate -props.html
    const base_name = this.info.base_filename
    const props_file = path.join(resources_dir, base_name + '-props.html')
    const custom_props_file = path.join(this.custom_dir, base_name + '-props.html')
    let props_html = Object.keys(this.info.props).map(p =>
      generate(propTMPL, this.info.props[p])
      ).join('\n')
    if (fs.existsSync(custom_props_file)) {
      const html = await fs.promises.readFile(custom_props_file, 'utf8')
      props_html += "\n" + html
    }
    //console.log(`\n\n***** Generating ${props_file} *****\n${props_html}`)
    await fs.promises.writeFile(props_file, props_html)

    // generate -info.js
    const info_file = path.join(resources_dir, base_name + '-info.js')
    const custom_info_file = path.join(path.resolve(this.custom_dir), base_name + '-info.js')
    if (fs.existsSync(custom_info_file)) {
      // merge the custom info, also into the props, i.e. don't just replace them...
      const custom_info = Object.assign({}, require(custom_info_file)) // clone due to symlink!
      const props = custom_info.props || {}
      delete custom_info.props
      Object.assign(this.info, custom_info)
      Object.assign(this.info.props, props)
    }
    const info_obj = { ...this.info, custom_handlers: undefined }
    const info_js = `export default ${JSON.stringify(info_obj, null, 2)}`
    //console.log(`\n\n***** Generating ${info_file} *****\n${info_js}`)
    await fs.promises.writeFile(info_file, info_js)

    // generate node html if not present
    const node_html_file = path.join(this.info.module_dir, base_name + '.html')
    if (!fs.existsSync(node_html_file)) {
      const node_tmpl_file = path.join(__dirname, 'templates', 'widget-node.html')
      const node_tmpl = await fs.promises.readFile(node_tmpl_file, 'utf8')
      const node_html = generate(node_tmpl, this.info)
      //console.log(`\n\n***** Generating ${node_html_file} *****\n${node_html}`)
      await fs.promises.writeFile(node_html_file, node_html)
    }

    // generate node js if not present
    const node_js_file = path.join(this.info.module_dir, base_name + '.js')
    if (!fs.existsSync(node_js_file)) {
      const node_tmpl_file = path.join(__dirname, 'templates', 'widget-node.js')
      const node_tmpl = await fs.promises.readFile(node_tmpl_file, 'utf8')
      const node_js = generate(node_tmpl, this.info)
      //console.log(`\n\n***** Generating ${node_js_file} *****\n${node_js}`)
      await fs.promises.writeFile(node_js_file, node_js)
    }
  }
}

if (require.main === module) {
  const module_dir = "."
  const custom_dir = "custom"
  const package = JSON.parse(fs.readFileSync(path.join(module_dir, 'package.json')))
  const pkg_json = []
  for (vue of fs.readdirSync(path.join(module_dir, 'widgets'))) {
    if (vue.endsWith('.vue')) {
      const widget_path = path.join(module_dir, 'widgets', vue)
      const cg = new FDWidgetCodeGen(widget_path, module_dir, custom_dir, package.name)
      cg.doit().then(() => { }).catch(e => { console.log(e.stack); process.exit(1) })
      const bn = path.basename(vue, '.vue')
      pkg_json.push(`      "flexdash ${bn}": "${bn}.js"`)
    }
  }
  
  // generate package.json fragment
  const pkg_file = path.join(module_dir, 'package-nodes.json')
  fs.writeFileSync(pkg_file, '{\n' + pkg_json.join(',\n') + '\n}\n')
}

module.exports = FDWidgetCodeGen
