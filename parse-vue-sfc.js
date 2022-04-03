// Hacky little parser for Vue SFC files
// Copyright ©2022 by Thorsten von Eicken, see LICENSE

module.exports = function (source) {

  function findWidgetScript(source) {
    const scriptRE = /^[ \t]*<script(>|\s[^>]*>)(.*?)<\/script>/gsm
    const exportRE = /^([ \t]*)export\s+default\s+{/m
    const widgetRE = '^##export\\s+default\\s+({.*?\\n##})\\s*$'

    let script
    let err = "cannot locate <script> block"
    while ((script = scriptRE.exec(source)) != null) {
      err = "cannot parse export default { ... } block"
      const m = script[2].match(exportRE)  // m[1] is whitespace before export statement
      if (!m) continue
      const re = new RegExp(widgetRE.replace(/##/g, m[1]), 'sm')
      const w = script[2].match(re)
      if (w) return w[1]
    }
    throw new Error(err)
  }

  function instantiateWidget(source) {
    source = source.replace(/^[ \t]*components\s*:\s*{[^}]*}\s*,?/m, "")
    return new Function(`return ${source}`)()
  }

  const w = instantiateWidget(findWidgetScript(source))
  return {
    name: w.name,
    help: w.help,
    props: w.props,
    output: w.output,
  }

}
