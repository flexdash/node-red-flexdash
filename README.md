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

## Disabled flows

When flows are disabled the nodes simply don't show up in the runtime. This means that the list of widgets in a container has IDs that are missing and look like they were deleted.

The config coming out of the flow editor needs to ensure that all nodes referenced in the "children"
list exist (in the flow editor). Then in the run-time, missing nodes found in the children list are
assumed to be disabled and are marked as such, but not removed.

When altering the position of widgets in the dashboard, the missing widgets need to be kept. When the
config is pushed back into the flow editor, the missing widgets should be "reconnected" with the disabled nodes.

- the pruning of deleted nodes in children lists must only happen in the flow editor

## Subflows

In the flow editor, widgets in subflows must be associated with an ArrayGrid (or a (Subflow?)Panel
in an ArrayGrid) and listed in the grid's children. Not clear how a static order is represented...

In the runtime, the subflow instance widgets show up, they need to be mapped to their template node
using the _alias property. The ordering in the ArrayGrid is then determined via the subflow node's ID.

Changing the order in the dashboard should result in a change in the order list in the ArrayGrid.
Changing the dimension and other properties needs to map back to the template nodes.

- the main trick seems to be to map N nodes in the runtime to 1 template node (which may not exist
  in the runtime?), plus an ordering/data key
- message routing then needs to use the ordering/data key also

Panels need to be similarly mapped back, but need to be transparent to the widget ordering/data
key stuff. Not clear how this happens...

It's not clear how to handle nesting of subflows, maybe it's just a concatenation of the subflow
instance IDs for the purpose of the ordering representation?


## License

MIT
