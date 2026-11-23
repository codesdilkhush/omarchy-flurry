import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "qml/components"
import "js/Settings.js" as Settings

// Native settings popup. Everything visible goes through the plugin's own
// translation catalog and every Text is PlainText. Writes are delegated to the
// bar widget, which owns the inline shell.json entry.
Panel {
  id: root
  moduleName: "snowglobe"
  ipcTarget: ""
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null

  readonly property var cfg: Settings.normalize(settings)
  readonly property var service: root.hostWidget ? root.hostWidget.service : null
  readonly property bool snowfallActive: root.cfg.enabled && root.cfg.overlay === "passive"
  readonly property bool blocked: root.service !== null && root.service.mode === "blocked"

  property bool confirmReset: false
  property bool confirmClearSnowmen: false

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // ---- Writes --------------------------------------------------------------
  function write(next) {
    if (root.hostWidget && typeof root.hostWidget.write === "function") root.hostWidget.write(next)
    else root.settings = Settings.toEntry(next, root.moduleName)
  }

  function patch(changes) {
    var out = ({})
    for (var k in root.cfg) out[k] = root.cfg[k]
    for (var c in changes) out[c] = changes[c]
    root.write(out)
  }

  function flip(key) {
    var change = ({})
    change[key] = !root.cfg[key]
    root.patch(change)
  }

  // Turning snowfall on must restore the click-through surface, not just flip
  // `enabled`: with overlay="disabled" the surface is unmapped. The bar widget
  // owns that rule, so the panel asks it instead of keeping a second copy.
  function toggleSnowfall() {
    if (root.hostWidget && typeof root.hostWidget.toggleSnowfall === "function") {
      root.hostWidget.toggleSnowfall()
      return
    }
    if (root.snowfallActive) root.patch({ enabled: false })
    else root.patch({ enabled: true, overlay: "passive" })
  }

  function cycleSetting(key, options) {
    var i = options.indexOf(root.cfg[key])
    var change = ({})
    change[key] = options[(i + 1) % options.length]
    root.patch(change)
  }

  // Destructive actions take two clicks; the second must follow within 4 s.
  function clearSnowmen() {
    if (!root.confirmClearSnowmen) {
      root.confirmClearSnowmen = true
      return
    }
    root.confirmClearSnowmen = false
    if (root.service) root.service.clearSnowmen()
  }

  function resetSettings() {
    if (!root.confirmReset) {
      root.confirmReset = true
      return
    }
    root.confirmReset = false
    root.write(Settings.toEntry(Settings.DEFAULTS, root.moduleName))
  }

  function toggleBuilder() {
    if (!root.service) return
    if (root.service.builderActive) root.service.exitBuilder()
    else root.service.enterBuilder()
    root.close()
  }

  function serviceValue(name) {
    if (!root.service) return strings.t("diag.unavailable")
    return String(root.service[name])
  }

  Timer {
    interval: 4000
    running: root.confirmReset
    onTriggered: root.confirmReset = false
  }

  Timer {
    interval: 4000
    running: root.confirmClearSnowmen
    onTriggered: root.confirmClearSnowmen = false
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget ? root.hostWidget : root
    bar: root.bar
    open: root.opened
    centerOnBar: false
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      implicitHeight: contentColumn.implicitHeight

      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: contentColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(2)

        // ---- Header -------------------------------------------------------
        Item {
          width: parent.width
          height: title.implicitHeight + Style.space(6)

          Text {
            id: title
            textFormat: Text.PlainText
            text: strings.t("panel.title")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            font.bold: true
          }

          Text {
            anchors.right: parent.right
            anchors.verticalCenter: title.verticalCenter
            textFormat: Text.PlainText
            text: root.blocked ? strings.t("state.blocked")
              : (root.snowfallActive ? strings.t("state.on") : strings.t("state.off"))
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        // Shown only when the overlay is held back because it would render
        // black; says why and what fixes it.
        Text {
          width: parent.width
          visible: root.blocked
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: strings.t("panel.blockedHelp")
          color: Commons.Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          bottomPadding: Style.space(6)
        }

        PanelSeparator { width: parent.width }

        // ---- Overview -----------------------------------------------------
        PanelSectionHeader { width: parent.width; text: strings.t("section.overview") }

        Toggle {
          width: parent.width
          label: strings.t("row.snowfall")
          checked: root.snowfallActive
          onClicked: root.toggleSnowfall()
        }

        SettingRow {
          width: parent.width
          label: strings.t("row.surface")
          value: root.cfg.overlay === "passive" ? strings.t("value.clickthrough") : strings.t("value.hidden")
          onClicked: root.cycleSetting("overlay", Settings.OVERLAY_MODES)
        }

        SettingRow {
          width: parent.width
          label: strings.t("row.layer")
          value: root.cfg.layer === "behind" ? strings.t("value.behind") : strings.t("value.above")
          onClicked: root.cycleSetting("layer", Settings.LAYERS)
        }

        SettingRow {
          width: parent.width
          label: strings.t("row.quality")
          value: strings.t("quality." + root.cfg.quality)
          onClicked: root.cycleSetting("quality", Settings.QUALITIES)
        }

        PanelSeparator { width: parent.width }

        // ---- Behavior -----------------------------------------------------
        PanelSectionHeader { width: parent.width; text: strings.t("section.behavior") }

        Toggle {
          width: parent.width
          label: strings.t("row.windowSnow")
          checked: root.cfg.accumulateOnWindows
          onClicked: root.flip("accumulateOnWindows")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.builder")
          checked: root.cfg.builderEnabled
          onClicked: root.flip("builderEnabled")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.plow")
          checked: root.cfg.plowEnabled
          onClicked: root.flip("plowEnabled")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.adaptive")
          checked: root.cfg.adaptiveQuality
          onClicked: root.flip("adaptiveQuality")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.fullscreen")
          checked: root.cfg.pauseOnFullscreen
          onClicked: root.flip("pauseOnFullscreen")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.guard")
          checked: root.cfg.transparencyGuard
          onClicked: root.flip("transparencyGuard")
        }

        PanelSeparator { width: parent.width }

        // ---- Snowmen ------------------------------------------------------
        PanelSectionHeader { width: parent.width; text: strings.t("section.snowmen") }

        SettingRow {
          width: parent.width
          label: strings.t("row.builderMode")
          value: root.service && root.service.builderActive ? strings.t("value.exit") : strings.t("value.enter")
          interactive: root.service !== null && (root.service.builderActive || root.service.overlayMapped)
          onClicked: root.toggleBuilder()
        }

        SettingRow {
          width: parent.width
          compact: true
          interactive: false
          label: strings.t("row.savedSnowmen")
          value: root.service ? String(root.service.snowmen.length) : "0"
        }

        SettingRow {
          width: parent.width
          label: root.confirmClearSnowmen ? strings.t("row.clearConfirm") : strings.t("row.clearSnowmen")
          value: root.confirmClearSnowmen ? strings.t("value.confirm") : ""
          onClicked: root.clearSnowmen()
        }

        PanelSeparator { width: parent.width }

        // ---- Diagnostics --------------------------------------------------
        PanelSectionHeader { width: parent.width; text: strings.t("section.diagnostics") }

        Repeater {
          model: [
            { key: "diag.mode", field: "mode" },
            { key: "diag.compositor", field: "compositorState" },
            { key: "diag.surfaces", field: "surfaceCount" },
            { key: "diag.screens", field: "screenCount" },
            { key: "diag.windows", field: "trackedWindows" },
            { key: "diag.banks", field: "bankCount" },
            { key: "diag.state", field: "stateStatus" },
            { key: "diag.version", field: "version" }
          ]
          delegate: SettingRow {
            required property var modelData
            width: contentColumn.width
            compact: true
            interactive: false
            label: strings.t(modelData.key)
            value: root.serviceValue(modelData.field)
          }
        }

        PanelSeparator { width: parent.width }

        // ---- Maintenance --------------------------------------------------
        PanelSectionHeader { width: parent.width; text: strings.t("section.maintenance") }

        SettingRow {
          width: parent.width
          label: root.confirmReset ? strings.t("row.resetConfirm") : strings.t("row.reset")
          value: root.confirmReset ? strings.t("value.confirm") : ""
          onClicked: root.resetSettings()
        }
      }
    }
  }
}
