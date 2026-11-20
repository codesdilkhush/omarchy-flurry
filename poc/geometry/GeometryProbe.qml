// Snowglobe Phase 0 proof of concept — Hyprland window geometry freshness.
// NOT part of the plugin. Run standalone:
//
//   quickshell -p poc/geometry/GeometryProbe.qml
//
// Then drag a window slowly across the screen, drag one fast, resize one from
// its corner, and switch workspaces. Read the log. Phase 0 needs three numbers
// that no documentation gives:
//
//   1. How stale is `HyprlandToplevel.lastIpcObject` between refreshes? (it is
//      only updated by Hyprland.refreshToplevels(), per the type's own warning)
//   2. Does a bounded refresh poll keep up with a drag, and what does it cost?
//   3. Which Hyprland socket2 events actually arrive during a drag or resize?
//      (the event histogram separates "we can be event-driven" from "we must
//      poll", and is the evidence for the geometry strategy in ARCHITECTURE.md)
//
// Everything here uses only Quickshell APIs: no subprocess, no hyprctl, no
// helper program. If the poll proves too laggy, the fallback is a raw
// Quickshell.Io.Socket client against $XDG_RUNTIME_DIR/hypr/$SIG/.socket.sock
// (that socket has Q_INVOKABLE write()/flush(), verified in src/io/socket.hpp).
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io

ShellRoot {
  id: root

  property int pollMs: 100          // active poll interval
  property int idleMs: 500          // idle poll interval
  property bool moving: false
  property int polls: 0
  property int refreshes: 0
  property var eventCounts: ({})
  property var lastSeen: ({})

  readonly property string hyprDir: (Quickshell.env("XDG_RUNTIME_DIR") || "")
    + "/hypr/" + (Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE") || "")

  // ---------------------------------------------------------------- geometry
  function snapshot() {
    const out = {}
    const toplevels = Hyprland.toplevels ? Hyprland.toplevels.values : []
    for (let i = 0; i < toplevels.length; i++) {
      const t = toplevels[i]
      const ipc = t.lastIpcObject || {}
      const at = ipc.at || [0, 0]
      const size = ipc.size || [0, 0]
      out[t.address] = {
        at: at,
        size: size,
        floating: ipc.floating === true,
        fullscreen: ipc.fullscreen || 0,
        hidden: ipc.hidden === true,
        workspace: ipc.workspace ? ipc.workspace.id : -1,
        title: ipc.title || t.title || ""
      }
    }
    return out
  }

  function diff(previous, next) {
    const moved = []
    for (const address in next) {
      const a = previous[address]
      const b = next[address]
      if (!a) { moved.push(address + " new"); continue }
      if (a.at[0] !== b.at[0] || a.at[1] !== b.at[1])
        moved.push(address + " at " + a.at.join(",") + " -> " + b.at.join(","))
      if (a.size[0] !== b.size[0] || a.size[1] !== b.size[1])
        moved.push(address + " size " + a.size.join("x") + " -> " + b.size.join("x"))
      if (a.workspace !== b.workspace) moved.push(address + " ws " + a.workspace + " -> " + b.workspace)
      if (a.floating !== b.floating) moved.push(address + " floating " + b.floating)
      if (a.fullscreen !== b.fullscreen) moved.push(address + " fullscreen " + b.fullscreen)
    }
    for (const address in previous) if (!next[address]) moved.push(address + " gone")
    return moved
  }

  // One shared poll. refreshToplevels() issues a single `j/clients` request and
  // ignores overlapping calls (HyprlandIpc::requestingToplevels guard), so the
  // cost is bounded by this timer, not by window count.
  Timer {
    id: poller
    interval: root.moving ? root.pollMs : root.idleMs
    repeat: true
    running: true
    onTriggered: root.tick()
  }

  function tick() {
    root.polls++
    root.refreshes++
    Hyprland.refreshToplevels()
    const next = root.snapshot()
    const changes = root.diff(root.lastSeen, next)
    root.lastSeen = next
    if (changes.length > 0) {
      root.moving = true
      console.info("[poc-geom] t=" + Date.now() + " poll#" + root.polls
                   + " changes=" + changes.length + " :: " + changes.slice(0, 4).join(" ; "))
      staleTimer.restart()
    }
  }

  // Stay on the fast interval for a moment after the last change, so a drag that
  // emits nothing for a frame or two does not drop back to the idle rate.
  Timer {
    id: staleTimer
    interval: 800
    onTriggered: root.moving = false
  }

  // ------------------------------------------------- Hyprland event histogram
  // The event socket is read directly (rather than through the Hyprland
  // singleton) purely to *count* events by name: the answer is what matters,
  // and an event we never see is an event we cannot be driven by.
  Socket {
    id: events
    connected: root.hyprDir !== "/hypr/"
    path: root.hyprDir + "/.socket2.sock"
    parser: SplitParser {
      onRead: function (line) {
        const arrow = line.indexOf(">>")
        const name = arrow >= 0 ? line.substring(0, arrow) : line
        root.eventCounts[name] = (root.eventCounts[name] || 0) + 1
      }
    }
  }

  Timer {
    interval: 2000
    running: true
    repeat: true
    onTriggered: {
      const parts = []
      for (const name in root.eventCounts) parts.push(name + "=" + root.eventCounts[name])
      console.info("[poc-events] " + (parts.length ? parts.join(" ") : "(none yet)"))
      root.eventCounts = ({})
      console.info("[poc-geom] polls=" + root.polls + " toplevels="
                   + (Hyprland.toplevels ? Hyprland.toplevels.values.length : 0)
                   + " fastPoll=" + root.moving)
    }
  }

  // Print the monitor table once, so the coordinate model can be checked
  // against `hyprctl monitors -j` on the same machine.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (event && event.name === "configreloaded") console.info("[poc-geom] hyprland config reloaded")
    }
  }

  Component.onCompleted: {
    const monitors = Hyprland.monitors ? Hyprland.monitors.values : []
    for (let i = 0; i < monitors.length; i++) {
      const m = monitors[i]
      console.info("[poc-monitor] " + m.name + " " + m.width + "x" + m.height
                   + " at " + m.x + "," + m.y + " scale=" + m.scale
                   + " transform=" + m.transform + " activeWs="
                   + (m.activeWorkspace ? m.activeWorkspace.id : "?"))
    }
    console.info("[poc] socket " + root.hyprDir + "/.socket2.sock")
  }
}
