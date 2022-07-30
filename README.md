node-red-flexdash
==================

_Node-RED nodes to interface with [FlexDash](https://github.com/flexdash/flexdash)_

FlexDash is a self-contained web dashboard for Node-RED and IoT devices.
This package provides [Node-RED](https://nodered.org/) nodes that interface with
FlexDash making it easy to send data to be displayed in the dashboard, and to
receive user input messages from the dashboard.

Under the hood the nodes here use [Socket.IO](http://socket.io/) and the dashboard(s) can use Node-RED's web server (i.e. the same port) or a different port.

For help, please read the [FlexDash Docs](https://flexdash.github.io/docs)
and check the [Node-RED forum](https://discourse.nodered.org).

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

Pre-release (dev) versions are published on npm using a "dev" tag:
- latest dev version: npm i @flexdash/node-red-flexdash-plugin@dev
- specific dev version: npm i @flexdash/node-red-flexdash-plugin@0.4.47

## To do

### Near term enhancements

- [ ] set-up demos for all widgets
- [ ] replace typedInput by something better, support unsetting, support color picker, fix booleans
- [ ] color picker for node-red using the material design palette
- [ ] support fd-custom node, i.e., compile vue SFC on-the-fly server-side

### Near term fixes

- [ ] fix reordering of array widgets
- [ ] new-dashboard should automatically use a different path

### Other

- [ ] enhance Widget API to support more complex data structures, specifically, ring buffers (arrays) and
  messages
- [ ] during NR deploy block changes from dashboards
- [X] keep static/dynamic setting across deploy
- [ ] support editing multiline text prop values in node-red
- [ ] implement checks for unsupported combinations: non-global tabs/dashboards, panels in panels,
  grids in subflows, nested subflows, array-widgets in array-panels, array/subflow combinations
- [X] fix order of props in NR edit pane
- [ ] support array-panels
- [ ] fix edit button for panels overlapping edit button of widget
- [ ] fix editing of array-widgets in the dashboard: need to propagate changes to all other widgets in the array
- [ ] implement array_max in array-widgets
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
- [ ] stat widget pill size

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

When altering the position of widgets in the dashboard, the missing widgets need to be kept.
When the config is pushed back into the flow editor, the missing widgets should be reconnected
with the disabled nodes.

- the pruning of deleted nodes in children lists must only happen in the flow editor

Widgets in disabled flows:
- End up as DisabledWidget widgets with an ID starting with an 'x' (that's not really important)

## Subflows

In the flow editor, widgets in subflows must be associated with a SubflowPanel.

It's not clear how to handle nesting of subflows, maybe it's just a concatenation of the subflow
instance IDs for the purpose of the ordering representation? Not implemented for now.

SubflowPanels:
- End up with widget IDs `w<subflow instance ID>-<panel config ID>`
- Changes to panel properties need to be reflected in the panel config
- ID of containing grid is in subflow instance env variable
- Containing grid has in its fd_children
- The panel node ID is pretty useless 'cause it changes at each deploy, while the subflow instance
  ID doesn't ('cause it's an actual node in some flow)
- Panels don't have any output in the dashboard, thus the `output` prop doesn't need to be set.

Widgets in SubflowPanels:
- End up with widget IDs `w<subflow instance ID>-<widget config ID>`
- The widget node IDs change with every deploy
- Changes to widget properties need to be applied to the widget config
- Output needs to be sent from a widget's instance node, whose ID changes per deploy
- The containing SubflowPanel has the widget IDs in its fd_children

Important: the structure of subflow widget IDs must not be used anywhere to drive logic, everything
must work if these IDs are replaced by random numbers.

## Array widgets

- Array widgets have a single node in Node-RED, the array aspect exists only on the FlexDash side
- An array is really a hash in that indices can be numbers or strings
- The existing array indices are only persisted in memory (but survive deploys) in the FD plugin
- Array widgets have IDs `w<node ID>-<index>`
- Changes to widget properties need to be reflected in the one node (and then apply to all)
- Output needs to be sent from the array widget node, but needs to include the index value

Array widgets cannot be placed in subflows. (Really?)

Important: the structure of array widget IDs must not be used anywhere to drive logic, everything
must work if these IDs are replaced by random numbers.

## IDs

#### FlexDash IDs

- widget nodes: `w<node-id>`
- widget nodes in subflow: `w<subflow-instance-id>-<node-in-subflowid>`
- array widget nodes: `w<node-id>|<topic>`
- array widget nodes in subflow: `w<subflow-instance-id>-<node-in-subflow-id>|<topic>`
- config nodes: `g<node-id>`, `p<node-id>`, `t<node-id>`

#### fd_children IDs

- widget nodes: Node-RED ID
- array widget nodes: Node-RED ID without topic
- config nodes: Node-RED ID
- subflow panel: Node-RED ID of panel instance
- widget node in subflow panel: Node-RED ID of template node

#### Widget fields

- dyn_root: `node-red/<widget-id>`
- output: `nr/<node-id>`
- group: `<array-node-id>`

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
  - For each node in a subflow template a new node is instantiated on deploy, its `._alias` has the
    ID of the node template.
  - The template nodes are not instantiated in the runtime, they remain solely as configs, i.e.,
    no constructor gets called.

  


## License

MIT
