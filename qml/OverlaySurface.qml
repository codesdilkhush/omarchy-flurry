import QtQuick
import Quickshell
import Quickshell.Wayland
import "../js/Constants.js" as Constants

// One fullscreen, transparent, click-through layer surface per monitor.
//
// `mask: Region {}` is empty in passive mode, and Quickshell turns an empty
// mask into Qt::WindowTransparentForInput plus an empty Wayland input region,
// so clicks pass through to whatever is underneath. The mask is the only thing
// that changes to capture input, and it is restored first when builder mode
// exits.
//
// Black-screen safety. A full-screen surface is only harmless while it is
// really transparent. Three things guard that:
//  1. `surfaceFormat.opaque: false` and `color: "transparent"` are set before
//     the window ever exists, so Quickshell never picks an opaque format.
//  2. The window is not mapped until the component has completed (`ready`),
//     so the first buffer the compositor sees is a fully configured,
//     transparent one, never a default-coloured placeholder.
//  3. The service only sets `passive`/`builderActive` when the compositor can
//     actually give this client an alpha buffer (see js/Compositor.js). When
//     it cannot, every pixel we would leave transparent comes out black, so the
//     surface stays unmapped instead of hiding the desktop.
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
  readonly property string monitorName: String(modelData && modelData.name ? modelData.name : "")

  // Set once the component (and therefore the surface format and colour) is
  // fully initialised. Nothing is mapped before that.
  property bool ready: false
  readonly property bool wanted: surface.passive || surface.builderActive

  screen: modelData
  visible: surface.ready && surface.wanted
  color: "transparent"
  // Ask the compositor for an alpha-capable surface *at creation time*.
  // Quickshell otherwise infers the format from the window colour; when that
  // inference runs before `color: "transparent"` is applied, the whole
  // fullscreen overlay comes up as an opaque black sheet over the desktop.
  // The format cannot be changed after the window exists.
  surfaceFormat {
    opaque: false
  }
  exclusionMode: ExclusionMode.Ignore

  WlrLayershell.namespace: Constants.OVERLAY_NAMESPACE
  WlrLayershell.layer: surface.builderActive ? WlrLayer.Overlay
    : (surface.behind ? WlrLayer.Bottom : WlrLayer.Top)
  WlrLayershell.keyboardFocus: surface.builderActive
    ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

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
    running: surface.visible
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

  onVisibleChanged: console.log("[snowglobe] surface " + (visible ? "mapped" : "unmapped")
    + " on " + surface.monitorName + " layer=" + (surface.behind ? "bottom" : "top"))

  Component.onCompleted: {
    // Defer by one event-loop turn so every property above (colour, format,
    // layer, mask) is applied before the window is created and mapped.
    Qt.callLater(function() { surface.ready = true })
  }
  Component.onDestruction: console.log("[snowglobe] surface destroyed on " + surface.monitorName)
}
