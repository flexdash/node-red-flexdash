node-red-flexdash
==================

_Node-RED nodes to interface with [FlexDash](https://github.com/flexdash/flexdash)_

FlexDash is a self-contained web dashboard for Node-RED and IoT devices.
This package provides [Node-RED](https://nodered.org/) nodes that form the core of a
FlexDash integration.
These nodes provide the basis for communicating with FlexDash but they do not make
any of the built-in widgets available.
For Node-RED nodes corresponding to the built-in widgets
use the [Node-RED FD CoreWidgets](https://github.com/flexdash/node-red-fd-corewidgets) package.

Under the hood the nodes here use [Socket.IO](http://socket.io/) and the dashboard(s) can use Node-RED's web server (i.e. the same port) or a different port.

For help, please read the [FlexDash Docs](https://flexdash.github.io/docs)
and check the [Node-RED forum](https://discourse.nodered.org).

## Installation

TL;DR: **You most likely do not want to explicitly install this package**, you want to
install the [core widgets](https://github.com/flexdash/node-red-fd-corewidgets), which will
bring in this package and more and will provide a usable whole.

`npm i @flexdash/node-red-fd-corewidgets`

If you really want to install node-red-flexdash, e.g., to get a specific version:

`npm i @flexdash/node-red-flexdash`

You also do not need to install [FlexDash](https://github.com/flexdash/flexdash), it comes
bundled in the node-red-flexdash package.

Pre-release (dev) versions are published on npm using a "dev" tag:
- latest dev version: npm i @flexdash/node-red-flexdash-plugin@dev
- specific dev version: npm i @flexdash/node-red-flexdash-plugin@0.4.47

## Internals

The main interface with FlexDash is `flexdash-dashboard.*`, which handles serving up
FlexDash and handling messages to/from the dashboard. It also exposes a config node to
represent the dashboard connection. There can be multiple dashboards as long as they use
different paths or ports.

The Node-RED plugin in `flexdash-plugin/*` is manages the hierarchy of FlexDash objects,
e.g. tabs, grids, panel, widget.
It is a Node-RED plugin so node-red widget nodes can call "into FlexDash" without having to
figure out how to get a handle onto the appropriate flexdash-dashboard config node first.
The plugin is in a subdirectory and forms a separate NPM package due to a bug in Node-RED.

The config nodes in `flexdash-tab.*` and `flexdash-container.*` represent containers for
widgets in the dashboard. `flexdash-container` can represent a grid or a panel. A Widget
either belongs to a grid or to a panel which itself belongs to a grid. A grid belongs to
a tab and there can be multiple tabs per dashboard.

The development server in `flexdash-dev-server.*` is a node that can be placed anywhere to
launch a development server for FlexDash widgets. It runs [Vite](https://vitejs.dev), which
is a web server that automatically pushes source code to the web browser as soon as you save
a file (hot module reload). To access the dev server, once launched, point your browser
at the dashboard URL plus a `-dev` suffix, e.g. `/flexdash-dev` instead of `/flexdash` for
the default set-up.
(Note: the dev server feature should be moved into a side-bar eventually.)

The `flexdash-in.*` and `flexdash-out.*` nodes are not currently supported.
They send/receive raw messages to/from FlexDash which supports advanced usage.
However, the current saving of dashboard configuration changes does not really support
such advanced usage, so these nodes are not currently exported.

### Some relevant Node-RED internals

- The flow editor operates on node configs that it passes to the runtime.
- The runtime has the node configs, but then operates on node objects, i.e. instantiations of
  the configs.
- The flow config can be traversed in the runtime using RED.nodes.eachNode, eachConfig,
  eachSubflow, etc. Confusingly RED.nodes.node is to query only active instantiated nodes!
- There are nodes in the config that are not instantiated: nodes in disabled flows and nodes in
  subflows are two examples.
- The set of active/instantiated flows cannot be traversed (no eachXxx function).
- There are nodes in the active set that are not in the config: nodes in instances of subflows are
  one example.
- Everything is a node: a flow, a subflow, a subflow instance, a node, a config node, etc.
- Special fields:
  - `.z` refers to the flow in which a node is located, it doesn't exist in global config nodes
  - `._alias` in runtime is found in nodes in subflows and refers to the config (template) that the
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

### Flows

This section describes how Node-RED-FlexDash represents dashboards, tabs,. grids, widgets, etc.
and integrates with the Node-RED concepts of flows, config nodes, nodes, etc.

#### Dashboard and Tab config nodes

- Dashboards and tabs are represented by config nodes in Node-RED. 
- A dashboard's `fd_children` is a list of tab node IDs.
- A tab has the dashboard's config node ID in `fd`, and `fd_children` contains a list of grids.
- For tabs the FlexDash ID generated is `t` followed by the Node-RED node ID.
- Thanks to a hack (see the code in flexdash-tab.html) Node-RED is not aware of the parent/child
  relationship between dashboards and tabs, which has the effect that exporting a bunch of
  nodes from a flow does not export the dashboard they are children of. This is good because
  on import, having a new dashboard created is almost never what the user wants.

#### Grid and Panel config nodes

- Both are represented by nodes of type "flexdash container" in Node-RED. See below
  for the rationale.
- A Grid's `tab` contains the ID of the tab config node to which it belongs.
- A Panel's `parent` contains the ID of the grid config node to which it belongs.
- Their `fd_children` contains a list of widget node IDs.
- A grid's `fd_children` may also contain panel config node IDs.
- For grids the FlexDash ID generated is `g` followed by the Node-RED node ID, and for
  panels the prefix is `w` (because panels are really a special form of widget in FlexDash).

#### Widgets and Array widgets

- A widget node's `fd_container` contains the ID of the grid or panel to which it belongs.
- The reason that grids and panels are both of type "flexdash container" (as opposed to having
  a "flexdash grid" and a "flexdash panel") is that this is required for the "container" drop down
  in a widget to include both grids and panels. I.e., it is not possible to ask Node-RED to
  provide a drop-down with two types of config nodes.
- For non-array widgets the generated FlexDash ID is `w` + Node-RED node ID
- For widgets that are arrays the FlexDash IDs generated are `w` + Node-RED node ID + `|` + the
  array topic.

#### Widget fields

- dyn_root: `node-red/<widget-id>` the topic path in FLexDash to which a widget should listen
- output: `nr/<node-id>` the topic in FlexDash that a widget should use for its output messages
- group: `<array-node-id>` a grouping of array widgets to allow moving them as a group

### Subflows

Node-RED FlexDash supports one level of subflows, that is, widget nodes can be placed in a subflow
and that subflow can be instantiated many times in flows, but it cannot be instantiated/nested in
another subflow.
In addition, all the widgets in a subflow must be placed into a SubflowPanel, i.e., associated
with a SubflowPanel config nodes and they will then appear in a panel in FlexDash.

Subflows are quite complicated because in the flow editor (and the "config" saved and passed
into the run-time) there are only the subflow "template" nodes and then a subflow instance node
for each instance of a subflow. The run-time then expands each subflow instance into a full
copy of the subflow template, so new nodes are created (with new IDs at each deploy!) and those
are the ones that exist in the run-time as "nodes" while the template nodes only exist as "config".

At a high level, the relationships in the flow editor are as follows:
- in the flow editor the user creates a subflow and places widgets into the subflow
- the user creates a subflow panel and associates it with the subflow (there must be a 1-1
  correspondence), and associates all the widgets in the subflow with that panel.
- the user then creates one or more subflow instances in various flows and associates each
  instance with a grid

In the end, the FlexDash hierarchy is as follows:
- each widget belongs to a subflow panel
- the subflow panel belongs to a subflow
- the subflow is instantiated one or multiple times
- each instance belong to a grid
- the grid belongs to a tab, which belongs to a dashboard

In the runtime all this stuff further gets instantiated:
each instance of the subflow results in a new set of widgets nodes and a new subflow panel node.
The subflow instance node remains as-is and the subflow itself is only present in the config.

The IDs of FlexDash widgets (incl. subflow panels) is `w` + the Node-RED ID, which means that
on every Node-RED deploy the FlexDash widgets are rebuilt from scratch. This is not ideal, but
the alternative would add quite a bit of complexity.

#### Subflow

- A subflow is represented by a `subflow` config in the flow editor, this config is not instantiated
  as a node in the run-time.

#### Subflow instance

- A subflow instance config refers to the subflow it instantiates by the type, specifically, 
  the type is `subflow:<config id>` where the ID is that of the subflow config.
- The subflow instance config's `z` refers to the flow in which it is placed.
- The subflow instance is instantiated in the run-time.
- A subflow instance is associated with a grid via a `flexdash_grid` env variable.

#### Subflow panel

- A subflow panel is a Node-RED config node of type "flexdash container".
- It must be associated with a subflow in the flow editor, which is represented in `z`.
- The panel's `fd_children` contains the IDs of the widget nodes it contains, however, these
  are the IDs of the template nodes, which are then instantiated with fresh IDs for each
  subflow instance...

#### Subflow panel instance

- When a subflow is instantiated an associated subflow panel is also instantiated as a node in
  the run-time.
- The subflow panel instance refers to the subflow instance using `z` and to its template
  node config using `_alias`.

#### Subflow widget

- A config in a subflow refers to a subflow panel using `fd_container` (like regular widgets).
- It gets instantiated as widget node for every subflow instance and then refers to the subflow
  instance using `z`, and to its template node config using `_alias`.

#### fd_container / fd_children

A widget config's `fd_container` refers to the subflow panel config, not to the subflow panel
instance node.
Similarly, a subflow panel's `fd_children` contains a list of subflow widget configs.

A subflow panel or a subflow panel instance do not have an `fd_container`. Instead, the containing
grid is found in the subflow instance `flexdash_grid` env variable.
The grid's `fd_children` contains the subflow instance ID.

## Disabled flows

When flows are disabled the nodes simply don't show up in the runtime. This means that
`fd_children` has IDs that are missing and look like they were deleted.

The config coming out of the flow editor needs to ensure that all nodes referenced in the "children"
list exist (in the flow editor). Then in the run-time, missing nodes found in the children list are
assumed to be disabled and are marked as such, but not removed.

When altering the position of widgets in the dashboard, the missing widgets need to be kept.
When the config is pushed back into the flow editor, the missing widgets should be reconnected
with the disabled nodes.

- the pruning of deleted nodes in children lists must only happen in the flow editor

Widgets in disabled flows end up with an ID starting with an 'x' to signal to FlexDash that
these are to be skipped.

## Dirty laundry

Node-red-flexdash uses a bunch of hacks to work around problems in Node-RED.
I'm listing them here in case I get asked which specific ones :-) :

- the annoying node-red-flexdash-plugin separation is necessary due to
  https://github.com/node-red/node-red/issues/3523
- panels and grids use the same config node type because in a drop-down one can only have
  config nodes of one type
- tabs do some hacky hiding of the dependency to the dashboard so the latter is not part of
  an export of a couple fo nodes
- the whole dependency tracking of which widgets belong to a panel/grid, which grids belong to a
  tab, etc. is a total nightmare due to there not being any signal that everything has been loaded,
  which makes it virtually impossible to prune dead nodes.
  https://discourse.nodered.org/t/new-editor-event-when-all-nodes-have-been-loaded/60314
- the edit panel for a subflow instance node with a FlexDash SubFlowPanel is monkey patched so
  one can select the grid/panel to display the node in (fd_container config node), this is
  necessary because one cannot create an env variable to select a config node
- the "general" tab in the node edit panel is hacked into the (hidden) DOM before a node is
  created but something like this would be much cleaner if done in oneditprepare, but that's
  too late to get the current values filled-in.
- the fact that nodes can only depend on config nodes and that config nodes can't send/receive
  messages (i.e., they can't appear in flows) means a "flexdash ctrl" node is necessary
- the whole notion of dependency tracking between nodes (incl. config nodes) is a mess, more
  in the flow editor than the run-time, but even there it's pretty murky when a node ID
  definitely refers to something that no longer exists. Also, the flow editor tracks
  "users" of a config node, that info is lost in the run-time (and has to be reconstructed by FD).

  

## License

MIT
