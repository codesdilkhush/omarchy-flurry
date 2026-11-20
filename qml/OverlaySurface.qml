import QtQuick
import Quickshell
import Quickshell.Wayland

// One fullscreen surface per monitor.
//
// Phase 1 has nothing to draw yet: this surface exists to prove the contract
// every later phase depends on — a mapped, transparent layer surface that takes
// no input. `mask: Region {}` is empty, and Quickshell turns an empty mask into
// Qt::WindowTransparentForInput plus an empty Wayland input region, so clicks
// pass through to whatever is underneath. The mask is the only thing that ever
// changes to capture input, and it is restored here first.
//
// State comes in as properties rather than being read from the service: a
// component in its own file does not see the enclosing file's ids.
PanelWindow {
  id: surface

  required property var modelData
  // Mapped and click-through. Anything else unmaps the surface entirely.
  property bool passive: false
  // Above the wallpaper and below ordinary windows, so the compositor does the
  // occlusion work. Otherwise draw over everything.
  property bool behind: true

  screen: modelData
  visible: passive
  color: "transparent"
  exclusionMode: ExclusionMode.Ignore

  WlrLayershell.namespace: "snowglobe"
  WlrLayershell.layer: behind ? WlrLayer.Bottom : WlrLayer.Top
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  anchors {
    top: true
    left: true
    right: true
    bottom: true
  }

  // Empty region: no pointer input, no keyboard, no focus. Never remove this
  // while the surface is mapped.
  mask: Region {}

  Component.onCompleted: console.log("[snowglobe] surface up on " + modelData.name
    + " layer=" + (behind ? "bottom" : "top"))
  Component.onDestruction: console.log("[snowglobe] surface down on " + modelData.name)
}
