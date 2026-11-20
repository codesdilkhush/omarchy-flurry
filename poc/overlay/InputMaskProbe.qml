// Snowglobe Phase 0 proof of concept — input pass-through vs. capture.
// NOT part of the plugin. Run standalone, never installed into the shell:
//
//   quickshell -p poc/overlay/InputMaskProbe.qml
//
// Then, with the probe running on the focused monitor:
//   1. PASSIVE phase (starts here): click a normal window underneath. It must
//      take focus exactly as if the probe were not running.
//   2. Press Super+Shift+P (or run `quickshell ipc call snowglobe-poc builder`)
//      to switch to CAPTURE phase: clicks must now hit the probe, which logs
//      them, and the window underneath must NOT react.
//   3. Press Escape to return to PASSIVE. Clicks must pass through again.
//
// What Phase 0 needs to learn from this, which no documentation states
// outright: whether an empty `Region {}` mask really makes a transparent
// fullscreen layer surface click-through on this compositor + Quickshell build,
// and whether switching the mask at runtime takes effect without remapping.
//
// Verified in Quickshell source before writing this: an empty PendingRegion
// (no item, zero rect, no sub-regions) builds a null QRegion, and
// ProxyWindowBase::onPolished() then sets
//   window->setFlag(Qt::WindowTransparentForInput, mask != null && mask.isEmpty())
//   window->setMask(mask)
// See src/core/region.cpp (PendingRegion::empty/build) and
// src/window/proxywindow.cpp (onPolished).
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland

ShellRoot {
  id: root

  // false = passive snow mode (click-through), true = builder mode (capture)
  property bool builderMode: false
  property int clickCount: 0
  property var lastClick: null

  function setBuilderMode(on) {
    root.builderMode = on
    console.info("[poc] mode=" + (on ? "CAPTURE (builder)" : "PASSIVE (click-through)"))
  }

  IpcHandler {
    target: "snowglobe-poc"

    function builder(): void { root.setBuilderMode(true) }
    function passive(): void { root.setBuilderMode(false) }
    function toggle(): void { root.setBuilderMode(!root.builderMode) }
    function status(): string {
      return JSON.stringify({
        builderMode: root.builderMode,
        clicks: root.clickCount,
        lastClick: root.lastClick
      })
    }
  }

  // Escape must leave builder mode. Only meaningful while the surface holds
  // keyboard focus, which is why capture mode also takes Exclusive focus.
  Item {
    focus: root.builderMode
    Keys.onPressed: function (event) {
      if (event.key === Qt.Key_Escape) {
        root.setBuilderMode(false)
        event.accepted = true
      }
    }
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: win
      required property var modelData
      screen: modelData

      anchors { top: true; bottom: true; left: true; right: true }
      color: "transparent"
      exclusionMode: ExclusionMode.Ignore
      WlrLayershell.namespace: "snowglobe-poc-input"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.keyboardFocus: root.builderMode ? WlrKeyboardFocus.Exclusive
                                                   : WlrKeyboardFocus.None

      // The whole experiment lives in this one property.
      //   passive: empty Region -> null QRegion -> Qt::WindowTransparentForInput
      //   capture: screen-sized Region -> clicks land here
      mask: root.builderMode
        ? captureRegion
        : emptyRegion

      Region { id: emptyRegion }

      Region {
        id: captureRegion
        x: 0
        y: 0
        width: win.width
        height: win.height
      }

      // Visible only in builder mode, so "is the overlay intercepting input"
      // is answerable by eye as well as by the logs.
      Rectangle {
        anchors.fill: parent
        visible: root.builderMode
        color: "#331e88e5"
        border.color: "#88bbdefb"
        border.width: 2

        Text {
          anchors.centerIn: parent
          color: "#ffffff"
          font.pixelSize: 22
          text: "SNOWGLOBE PoC — BUILDER MODE\nclicks: " + root.clickCount + "\nEsc to return to passive"
          horizontalAlignment: Text.AlignHCenter
        }
      }

      MouseArea {
        anchors.fill: parent
        enabled: root.builderMode
        onClicked: function (mouse) {
          root.clickCount++
          // Screen-local coordinates: exactly what the builder needs, and proof
          // that the click arrived at this surface rather than the window below.
          root.lastClick = {
            screen: win.modelData.name,
            x: Math.round(mouse.x),
            y: Math.round(mouse.y)
          }
          console.info("[poc] click on " + win.modelData.name + " at " + Math.round(mouse.x) + "," + Math.round(mouse.y))
        }
      }

      // ShellScreen has no `scale`: it exposes devicePixelRatio, which is why the
      // coordinate model is expressed in logical px plus devicePixelRatio.
      Component.onCompleted:
        console.info("[poc] surface " + win.modelData.name + " " + win.width + "x" + win.height
                     + " dpr=" + win.modelData.devicePixelRatio)
    }
  }

  // Records the monitor layout the PoC observed, so the coordinate model can be
  // checked against `hyprctl monitors` on the same machine.
  Connections {
    target: Quickshell
    function onScreensChanged() {
      const parts = []
      for (let i = 0; i < Quickshell.screens.length; i++) {
        const s = Quickshell.screens[i]
        parts.push(s.name + " " + s.width + "x" + s.height + " dpr=" + s.devicePixelRatio
                   + " (" + s.x + "," + s.y + ")")
      }
      console.info("[poc] screens: " + parts.join(" | "))
    }
  }
}
