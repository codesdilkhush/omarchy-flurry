import QtQuick
import Quickshell
import Quickshell.Wayland
import "../js/Constants.js" as Constants

// One fullscreen surface per monitor.
//
// Phase 1 has nothing to draw yet: this surface exists to prove the contract
// every later phase depends on — a mapped, transparent layer surface that takes
// no input. `mask: Region {}` is empty, and Quickshell turns an empty mask into
// Qt::WindowTransparentForInput plus an empty Wayland input region, so clicks
// pass through to whatever is underneath. The mask is the only thing that ever
// changes to capture input, and it is restored first when builder mode exits.
PanelWindow {
  id: surface

  required property var modelData
  // Mapped and click-through. Anything else unmaps the surface entirely.
  property bool passive: false
  // Above the wallpaper and below ordinary windows, so the compositor handles
  // occlusion. Otherwise draw over everything.
  property bool behind: true
  // Owned by the service and keyed by monitor name. Passing it in keeps this
  // component independent of the service's ids and of Hyprland.
  property var simulation: null
  // Builder mode is an explicit, temporary input state. The service switches
  // it off on Escape or from the panel, restoring full click-through.
  property bool builderActive: false
  property var service: null
  property var snowmen: []
  property int snowmenRevision: 0
  readonly property string monitorName: String(modelData.name || "")

  screen: modelData
  visible: passive || builderActive
  color: "transparent"
  // Ask the compositor for an alpha-capable surface *at creation time*.
  // Quickshell otherwise infers the format from the window colour; when that
  // inference runs before `color: "transparent"` is applied, the whole
  // fullscreen overlay comes up as an opaque black sheet over the desktop —
  // the exact "black render" this fix targets. The format cannot be changed
  // after the window exists, so it has to be requested here, up front.
  surfaceFormat {
    opaque: false
  }
  exclusionMode: ExclusionMode.Ignore

  WlrLayershell.namespace: Constants.OVERLAY_NAMESPACE
  WlrLayershell.layer: builderActive ? WlrLayer.Overlay : (behind ? WlrLayer.Bottom : WlrLayer.Top)
  WlrLayershell.keyboardFocus: builderActive ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  anchors {
    top: true
    left: true
    right: true
    bottom: true
  }

  // Input region is the only thing that changes between modes: empty in
  // passive mode (full click-through), full-screen while building.
  mask: Region {
    width: surface.builderActive ? surface.width : 0
    height: surface.builderActive ? surface.height : 0
  }

  // Snow is drawn inside the click-through surface: the empty mask keeps all
  // pointer events going to the applications beneath it.
  MonitorScene {
    id: sceneLayer
    anchors.fill: parent
    simulation: surface.simulation
  }

  // Finished snowmen remain visible in passive mode; the renderer is always
  // mapped, but only repaints when the persisted model changes.
  SnowmanRenderer {
    anchors.fill: parent
    snowmen: surface.snowmen
    revision: surface.snowmenRevision
    monitorName: surface.monitorName
  }

  SnowmanBuilder {
    id: builderTool
    anchors.fill: parent
    visible: surface.builderActive
    service: surface.service
    monitorName: surface.monitorName
  }

  // The builder reads the simulation's JS roll object on the scene's existing
  // frame, so the eased ball is drawn where the physics actually is.
  Connections {
    target: sceneLayer
    function onFrame() { builderTool.syncRoll() }
  }

  Component.onCompleted: console.log("[snowglobe] surface up on " + modelData.name
    + " layer=" + (behind ? "bottom" : "top"))
  Component.onDestruction: console.log("[snowglobe] surface down on " + modelData.name)
}
