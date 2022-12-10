// Interface to the Vue3 SFC compiler (Single File Components)
// Adapted from https://github.com/rockboom/vue3-compiler-sfc
// Copyright ©2021-2022 by Thorsten von Eicken, see LICENSE

const { parse, compileTemplate, compileScript, compileStyle, } = require('@vue/compiler-sfc')
const hash = require('hash-sum')

// compiler accepts a source string together with a name (supposed to be file name) and
// returns { render, script, styles, errors }
module.exports = function (nr_id, sfc_source) {
  const scopeId = hash(nr_id + '\n' + sfc_source)
  const filename = `node_${nr_id}.vue`

  const options = {
    filename: filename,
    source: '', // set to each part in turn
    id: scopeId,
    inlineTemplate: true,
    isProd: false,
    templateOptions: {
      compiler: undefined,
      compilerOptions: {
        scopeId: scopeId,
        bindingMetadata: undefined,
      },
      filename: filename,
      id: scopeId,
      isProd: false,
      scoped: true,
      preprocessCustomRequire: undefined,
      preprocessLang: undefined,
      preprocessOptions: undefined,
      ssr: false,
      ssrCssVars: [],
      transformAssetUrls: undefined
    }
  }

  // parse the source code, which will produce its parts (script, template, style)
  const { descriptor, errors } = parse(sfc_source)
  if (errors && errors.length > 0) return { script: null, styles: null, errors }
  let script = ""

  // compile the template part into a render function
  if (descriptor.template) {
    options.source = descriptor.template.content
    const template = compileTemplate(options)
    //console.log('===== template:\n', template)
    script += template.code.replace(/export\s*/, '')
  }

  // compile the script part into plain javascript
  if (descriptor.script) {
    options.source = descriptor.script.content
    const scriptDescr = compileScript(descriptor, options)
    //console.log('===== script:\n', scriptDescr)
    script += '\n' + scriptDescr.content.replace(/export\s*default/, 'const script = ')
  } else {
    script += '\nconst script = {}'
  }

  // compile the style part
  let styles = null
  if (descriptor.styles) {
    styles = descriptor.styles.map(style => {
      options.source = style.content
      const styleDescr = compileStyle(options)
      //console.log('===== style:\n', styleDescr)
      return styleDescr.code
    }).join('\n')
  }

  // finish up by inserting the render function into the script
  script += '\nscript.render = render'
  script += `\nscript._scopeId = "data-v-${scopeId}"`
  script += '\nexport default script'

  // return concat of render function and script&style
  return { script, styles, hash: scopeId, errors: null }
}
