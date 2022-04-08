node-red-flexdash
==================

_Node-RED nodes to interface with [FlexDash](https://github.com/tve/flexdash)_

FlexDash is a self-contained web dashboard for Node-RED and IoT devices.
This package provides [Node-RED](https://nodered.org/) nodes that interface with
FlexDash making it easy to send data to be displayed in the dashboard, and to
receive user input messages from the dashboard.

Under the hood the nodes here use [Socket.IO](http://socket.io/) and the dashboard(s) can use Node-RED's web server (i.e. the same port) or a different port.

Please refer to the
[FlexDash Documentation](https://flexdash.github.io) for a quick-start guide, tutorials,
and more...

## Installation

To install node-red-flexdash use:

`npm i @flexdash/node-red-flexdash`

On its own node-red-flexdash doesn't provide any widgets to fill a dashboard with,
it is thus recommended to install the
[core widgets](https://github/com/flexdash/node-red-fd-corewidgets):

`npm -i @flexdash/node-red-fd-corewidgets`

Quick-start (more in detail in the
[FlexDash Documentation](https://flexdash.github.io/quick-start), see below):
- import one of the simple examples from the node-red-corewidgets module
- edit one of the FlexDash nodes that show up, edit its grid configuration node, add a
  tab configuration node (default config OK) and add a dashboard configuration node (again,
  deafults are OK)
- deploy
- point your browser at http://localhost:1880/flexdash
  (same hostname/port you use for the Node-RED editor)


## Internals

The main interface with FlexDash is `flexdash-dashboard.*`, which handles serving up
FlexDash and handling messages to/from the dashboard. It also exposes a config node to
represent the dashboard connection. There can be multiple dashboard as long as they use
different paths or ports.

The Node-RED plugin in `flexdash-plugin.*` is a relatively simple piece that is a plugin only
so node-red widget nodes can call "into FlexDash" without having to figure out how to get
a handle onto the appropriate flexdash-dashboard config node first.

The config nodes in `flexdash-tab.*` and `flexdash-container.*` represent containers for
widgets in the dashboard. `lfexdash-container` can represent a grid or a panel. A Widget
either belongs to a grid or to a panel which itself belongs to a grid. A grid belongs to
a tab and there can be multiple tabs per dashboard.

The development server in `flexdash-dev-server.*` is a node that can be placed anywhere to
launch a development server for FlexDash widgets. It runs [Vite](https://vitejs.dev), which
is a web server that automatically pushes source code to the web browser as soon as you save
a file (hot module reload). To access the dev server, once launched, point your browser
at the dashboard URL plus a `-src` suffix, e.g. `/flexdash-src` instead of `/flexdash` for
the default set-up.
(Note: the dev server feature should be moved into a side-bar eventually.)

The `flexdash-in.*` and `flexdash-out.*` nodes are not currently supported.
They send/receive raw messages to/from FlexDash which supports advanced usage.
However, the current saving of dashboard configuration changes does not really support
such advanced usage, so these nodes are not currently exported.


## License

MIT
