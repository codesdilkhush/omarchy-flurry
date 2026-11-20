import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "qml"
import "js/Settings.js" as Settings
import "js/State.js" as StateModule

// Snowglobe's service: the only owner of simulation state, preferences and the
// overlay surfaces. Phase 1 is deliberately thin — it holds the mode machine and
// maps one passive surface per monitor. No snow, no particles, no polling yet.
//
// Injected by omarchy-shell for a third-party service: `shell` is a
// capability-scoped facade (never the host shell object), plus manifest.
Item {
  id: snowglobe

  property var shell: null
  property var manifest: null

  // Preferences arrive from the bar widget, which owns the inline shell.json
  // entry. Absent a bar widget the defaults apply.
  property var rawSettings: ({})

  readonly property var settings: Settings.normalize(rawSettings)

  // Disabled unmaps every surface (zero cost); passive keeps them mapped and
  // click-through. Paused is a temporary passive-off used while a monitor is
  // asleep or something fullscreen is in front.
  property bool paused: false

  readonly property string mode: {
    if (!settings.enabled || settings.overlay === "disabled") return "disabled"
    if (paused) return "paused"
    return "passive"
  }

  readonly property bool overlayMapped: mode === "passive"
  readonly property int surfaceCount: overlayVariants.instances.length

  // One surface per monitor, rebuilt when the screen list changes. A removed
  // monitor's surface is destroyed with its delegate rather than reused.
  Variants {
    id: overlayVariants
    model: Quickshell.screens

    OverlaySurface {
      passive: snowglobe.overlayMapped
      behind: snowglobe.settings.layer !== "above"
    }
  }

  // Diagnostics for the CLI and for the Phase 1 verification steps. Read-only:
  // preferences are written through the bar widget's inline entry, never here.
  ShellIpc {
    target: "snowglobe"

    function status(): string {
      return JSON.stringify({
        mode: snowglobe.mode,
        enabled: snowglobe.settings.enabled,
        layer: snowglobe.settings.layer,
        quality: snowglobe.settings.quality,
        surfaces: snowglobe.surfaceCount,
        screens: Quickshell.screens.length,
        state: snowglobe.stateStatus
      })
    }

    function pause(): void { snowglobe.paused = true }
    function resume(): void { snowglobe.paused = false }
  }

  // ---- State document -----------------------------------------------------
  // Read and validated, never written in Phase 1: there is nothing to save
  // until the snowman builder exists. An invalid document is reported and left
  // untouched on disk rather than overwritten.
  readonly property string statePath: {
    var base = Quickshell.env("XDG_STATE_HOME")
    if (!base) base = Quickshell.env("HOME") + "/.local/state"
    return base + "/snowglobe/state.json"
  }

  property string stateStatus: "not loaded"
  property var savedSnowmen: []

  function applyState(text) {
    var parsed = StateModule.parse(String(text || ""))
    if (!parsed.ok) {
      stateStatus = "invalid: " + parsed.reason
      savedSnowmen = []
      return
    }
    stateStatus = "ok: " + parsed.state.snowmen.length + " snowmen"
    savedSnowmen = parsed.state.snowmen
  }

  FileView {
    id: stateFile
    path: snowglobe.statePath
    watchChanges: false
    onLoaded: snowglobe.applyState(text())
    onLoadFailed: snowglobe.stateStatus = "missing or unreadable"
  }

  Component.onCompleted: console.log("[snowglobe] service ready, mode=" + mode)
}
