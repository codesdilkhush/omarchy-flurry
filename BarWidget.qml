import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "js/Settings.js" as Settings

// The bar entry. It owns no simulation: it reads the inline shell.json entry,
// pushes it to the service, and asks the host to write it back through
// updateEntryInline — the plugin never touches shell.json itself.
BarWidget {
  id: root
  moduleName: "snowglobe"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor("snowglobe") : null
  readonly property var cfg: Settings.normalize(root.settings)
  readonly property bool snowfallOn: cfg.enabled && cfg.overlay === "passive"

  implicitWidth: glyph.implicitWidth + Style.space(14)
  implicitHeight: barSize

  function pushSettings() {
    if (root.service) root.service.rawSettings = root.settings ? root.settings : ({})
  }

  // A shallow copy of the current settings with `patch` applied. Kept explicit
  // rather than using object spread so nothing from an older schema leaks in.
  function merged(patch) {
    var out = ({})
    for (var k in root.cfg) out[k] = root.cfg[k]
    for (var p in patch) out[p] = patch[p]
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
  onBarChanged: {
    pushSettings()
    injectPanel()
  }
  onServiceChanged: pushSettings()
  onSettingsChanged: {
    pushSettings()
    injectPanel()
  }

  Text {
    id: glyph
    anchors.centerIn: parent
    textFormat: Text.PlainText
    text: "❄"
    font.pixelSize: Style.font.body
    color: root.snowfallOn
      ? (root.bar ? root.bar.barForeground : Commons.Color.foreground)
      : Qt.darker(root.bar ? root.bar.barForeground : Commons.Color.foreground, 1.8)
    opacity: root.snowfallOn ? 1 : 0.7
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    cursorShape: Qt.PointingHandCursor
    onClicked: function(mouse) {
      if (mouse.button === Qt.RightButton) root.togglePanel()
      else root.toggleSnowfall()
    }
  }

  // ---- Panel contract ----------------------------------------------------
  // The bar's popout routing looks for open/close/opened on the widget root.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = buttonItem
    if ("hostWidget" in target) target.hostWidget = root
  }

  Item {
    id: buttonItem
    anchors.fill: parent
    visible: false
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

  ShellIpc {
    target: "snowglobe.bar"

    function toggle(): void { root.toggleSnowfall() }
    function openPanel(): void { root.open() }
    function closePanel(): void { root.close() }
    function status(): string {
      return JSON.stringify({ on: root.snowfallOn, settings: root.cfg })
    }
  }
}
