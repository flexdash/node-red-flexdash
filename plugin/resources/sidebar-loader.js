// FlexDash sidebar loader - loads the Vue/Vuetify dependencies, creates the FlexDash sioebar app
// and mounts it into the element passed in. Also provides the Vue SFC loader in window.loadSFC
// This file cannot be reloaded dynamically, gotta restart Node-RED (yawn...). Everything else
// in the sidebar app can be reloaded by this here...
// Copyright ©2022 Thorsten von Eicken, MIT license, see LICENSE file

// importing Vue and Vuetify as ESM doesn't work because Vuetify imports from 'vue' and that doesn't exist.
//import { createApp } from './node_modules/vue/dist/vue.esm-browser.js'
//import { createVuetify } from './node_modules/vuetify/dist/vuetify.esm.js'
// instead we load the CJS versions that define global variables Vue and Vuetify
const { createApp, h } = Vue
const { createVuetify } = Vuetify
const { loadModule } = window['vue3-sfc-loader']

// config for the SFC loader
const sfc_prefix = 'resources/@flexdash/node-red-flexdash-plugin/'
const sfc_options = {
    moduleCache: null,
    async getFile(url) {
        const res = await fetch(sfc_prefix + url)
        if (!res.ok) throw Object.assign(new Error(url+' '+res.statusText), { res })
        return await res.text()
    },
    addStyle(textContent) {
        const style = Object.assign(document.createElement('style'), { textContent })
        document.head.appendChild(style)
    },
}

const sb = {
    app: null, // the Vue app
    // unload the sidebar app
    unload() {
        if (sb.app) sb.app.unmount()
        sb.app = null
        if (sb.vuetify) console.log("Unload Vuetify?", Object.keys(sb.vuetify).join(', '))
        sfc_options.moduleCache = null // hopefullty GC can reclaim all that...
    },
    // load/reload the sidebar app
    load(elId, flexdash) {
        console.log("Loading FlexDash side-bar into " + elId)
        $(elId).html(`This is not FlexDash!`)

        // unmount first, if already mounted
        if (sb.app) sb.app.unmount()

        // clear module cache so we can reload the SFCs
        sfc_options.moduleCache = { vue: Vue, vuetify: Vuetify }

        // load the top-level SFC (we get a promise)
        const FDSidebar = sb.load_sfc('sidebar.vue')

        // create & mount the app with Vuetify
        sb.vuetify = createVuetify({
            defaults: {
                global: {
                    density: 'compact',
                    'hide-details': true,
                },
                'VTooltip': { anchor: 'bottom' },
            },
            theme: {
                defaultTheme: 'nrLight',
                themes: {
                    nrLight: {
                        dark: false,
                        colors: {
                            background: '#f7f5f5',
                            surface: '#fffdfd',
                            primary: '#ad1625', // Node-RED red
                            secondary: '#887777',
                            error: '#ec7422',
                            info: '#2196F3',
                            success: '#4CAF50',
                            warning: '#FB8C00',
                        },
                    },
                }
            }
        })
        sb.app = createApp({
            render() { return h(FDSidebar) },
        })
        sb.app.use(sb.vuetify)
        sb.app.provide("$flexdash", flexdash),
        sb.app.mount(elId)
    },
    // load a Vue Single File Component
    load_sfc(path) {
        const prom = loadModule(path, sfc_options)
        return Vue.defineAsyncComponent(() => prom)
    },
}
window.loadSFC = sb.load_sfc
export default sb
