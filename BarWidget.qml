import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "js/Settings.js" as Settings

// The bar entry. It owns no simulation: it reads the inline shell.json entry,
// normalizes it, pushes it to the service, and asks the host to write changes
// back through updateEntryInline. The plugin never edits shell.json itself.
BarWidget {
  id: root
  moduleName: "snowglobe"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor("snowglobe") : null
  readonly property var cfg: Settings.normalize(root.settings)
  readonly property bool snowfallOn: cfg.enabled && cfg.overlay === "passive"

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  implicitWidth: Style.bar.iconSlot
  implicitHeight: barSize

  function pushSettings() {
    if (root.service) root.service.rawSettings = root.settings ? root.settings : ({})
  }

  // Shallow copy of the current settings with `patch` applied. Kept explicit
  // so nothing from an older schema can leak back into shell.json.
  function merged(patch) {
    var out = ({})
    for (var k in root.cfg) out[k] = root.cfg[k]
    if (patch && typeof patch === "object")
      for (var p in patch) if (p in out) out[p] = patch[p]
    return out
  }

  function write(next) {
    var entry = Settings.toEntry(next, root.moduleName)
    root.settings = entry
    var host = root.bar ? root.bar.shell : null
    if (host && typeof host.updateEntryInline === "function")
      host.updateEntryInline(root.moduleName, entry)
    pushSettings()
  }

  function toggleSnowfall() {
    if (root.snowfallOn) root.write(root.merged({ enabled: false }))
    else root.write(root.merged({ enabled: true, overlay: "passive" }))
  }

  Component.onCompleted: pushSettings()
  onBarChanged: { pushSettings(); injectPanel() }
  onServiceChanged: pushSettings()
  onSettingsChanged: { pushSettings(); injectPanel() }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "❄"
    tooltipText: strings.t(root.snowfallOn ? "bar.tooltip.on" : "bar.tooltip.off")
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.RightButton) root.togglePanel()
      else root.toggleSnowfall()
    }
  }

  // ---- Panel contract ----------------------------------------------------
  // The bar's popout routing looks for opened/open/close on the widget root.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  // ---- Shell control -----------------------------------------------------
  ShellIpc {
    target: "snowglobe.bar"

    function toggle(): void { root.toggleSnowfall() }
    function openPanel(): void { root.open() }
    function closePanel(): void { root.close() }

    // Applies a bounded patch: unknown keys are ignored, values are coerced to
    // their declared ranges, and a failed parse changes nothing.
    function configure(payload: string): string {
      var patch
      try {
        patch = JSON.parse(payload)
      } catch (e) {
        return JSON.stringify({ ok: false, reason: "invalid JSON" })
      }
      if (!Settings.isPlainObject(patch))
        return JSON.stringify({ ok: false, reason: "not an object" })
      root.write(root.merged(patch))
      return JSON.stringify({ ok: true, settings: Settings.normalize(root.settings) })
    }

    function status(): string {
      return JSON.stringify({ on: root.snowfallOn, settings: root.cfg })
    }
  }
}
