node-red-contrib-flexdash
=========================

_NodeRED nodes to interface with [FlexDash](https://github.com/tve/flexdash)_

FlexDash is a self-contained web dashboard for NodeRED and IoT devices.
This package provides [Node-RED](https://nodered.org/) nodes that interface with
FlexDash making it easy to send data to be displayed in the dashboard, and to
receive user input messages from the dashboard.

Under the hood the nodes here use [Socket.IO](http://socket.io/) and in FlexDash
the socket.io connection should be configured.

## Installation

To install node-red-contrib-flexdash use:

`npm i node-red-contrib-flexdash`

## Configuration

The flexdash nodes are similar to most networking nodes in Node-RED: there is a
`flexdash-out` node to send data to FlexDash and a `flexdash-in` node to receive
user input messages. Instatiating either one creates a configuration node that
captures the socket.io options and creates a network listener in the background.

The simplest set-up consists of just a `flexdash-out` node to send some data to
the dashboard.

## Usage

The best way to learn how to use FlexDash with Node-RED is to launch FlexDash
and to follow the simple tutorials that are a part of the FlexDash demo configuration.
You can launch FlexDash from https://tve.github.io/flexdash without installing anything
and you can try some simple things out with Node-RED using plain websockets again
without installing anything: look at the info on the `websock` tab in FlexDash.

For real use the node-red-contrib-flexdash nodes are highly recommended. The way
FlexDash works is as follows:
- on the Node-RED side you send messages with `topic` and `payload` to a `flexdash-out`
  node, this data is forwarded to FlexDash and entered into its topic tree
- on the FlexDash size, you instantiate a widget, say a gauge, you configure it
  in FlexDash (title, color, min, max, etc) and you bind an input (typ. value)
  to a topic.
- when a message is sent with the chosen topic to flexdash the widget updates
  automatically.
- note that any of the widget inputs can be bound to dynamic values, for example,
  the color could be set via messages from Node-RED as well.

For user input, the output of a widget can be assigned a topic, when the user
interacts with the widget to produce output (e.g. pressing a button or toggling
a switch) the widget sends an output value to the topic, which "comes out" of
every `flexdash-out` node (unless the node is configured with a topic filter).

For further information, please see the help text that comes with each FlexDash node.

## License
MIT
