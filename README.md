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

## To do

- [ ] enhance Widget API to support more complex data structures, specifically, ring buffers (arrays) and
  messages
- [ ] set-up demos for all widgets
- [ ] during NR deploy block changes from dashboards
- [X] keep static/dynamic setting across deploy
- [ ] replace typedInput by something better, support unsetting
- [ ] support editing multiline text prop values in node-red
- [ ] color picker for node-red using the material design palette
- [ ] implement checks for unsupported combinations: non-global tabs/dashboards, panels in panels,
  grids in subflows, nested subflows, array-widgets in array-panels, array/subflow combinations
- [X] fix order of props in NR edit pane
- [ ] support array-panels
- [ ] fix edit button for panels overlapping edit button of widget
- [ ] fix reordering of array widgets
- [ ] fix editing of array-widgets in the dashboard: need to propagate changes to all other widgets in the array
- [ ] support fd-custom node, i.e., compile vue SFC on-the-fly server-side
- [ ] implement array_max in array-widgets
- [ ] new-dashboard should automatically use a different path
- [X] Windows 10 support
- [ ] Basic login mechanism
- [ ] Wrap onInput callback into try/catch
- [ ] Pass flexdash client id to onInput handler
- [ ] Edit mode disable/off/on setting, per-user if there's auth
- [ ] Create an "any widget" node
- [ ] Add logging verbosity switch to dashboard config node
- [ ] Don't log every message sent to FD, or at least shorten
- [X] Fix display of tab name as title if title is empty
- [ ] Remove "Widget X has not prop Y" warning

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

SubflowPanels:
- End up with widget IDs `w<subflow instance ID>-<panel config ID>
- ID of containing grid is in subflow instance env variable
- Containing grid has fd_children with `w<subflow>-<panel>` because the order of these needs
  to be persisted.
- The panel node ID is pretty useless 'cause it changes at each deploy

Widgets in SubflowPanels:
- End up with widget IDs `w<subflow instance ID>-<widget config ID> mostly because otherwise it
  requires an extra data structure to locate the widget instance node ID (prob would have to do the
  latter to support array widgets in subflows).
- When expanding the SubflowPanel's fd_children the widget config ID is converted to wSSS-NNN.

Array widgets:
- End up with widget IDs `w<widget ID>-<index> in order to support the one-to-many.

## Node-RED internals

- The flow editor operates on node configs that it passes to the runtime.
- The runtime has the node configs, but then operates on node objects, i.e. instantiations of
  the configs.
- The flow config can be traversed in the runtime using RED.nodes.eachNode, eachConfig,
  eachSubflow, etc. Confusingly RED.nodes.node is to query active instantiated nodes!
- There are nodes in the config that are not instantiated: nodes in disabled flows and nodes in
  subflows are two examples.
- The set of active/instantiated flows cannot be traversed (no eachXxx function).
- There are nodes in the active set that are not in the config: nodes in instances of subflows are
  one example.
- Everything is a node: a flow, a subflow, a subflow instance, a node, a config node, etc.
- Special fields:
  - `.z` refers to the flow in which a node is located, it doesn't exist in global config nodes
  - `._alias` in runtime is found in nodes in subflows and refers to the node (config) that the
    node was instantiated from
  - `.d` is true(?) for nodes in disabled flows
- Subflows:
  - The subflow "template" is represented by a type=subflow node.
  - A node type `subflow:<subflow node id>` is created for each subflow.
  - Subflow instance nodes are of that type
  - For each node in a subflow "template" a new node in instantiated on deploy, its `._alias` has the
    ID of the node "template".
  - The "template" nodes are not instantiated in the runtime, they remain solely as configs, i.e.,
    no constructor gets called.

  


## License

MIT
