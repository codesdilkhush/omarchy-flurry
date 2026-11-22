import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
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

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

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

  // Turning snowfall on must restore the click-through surface, not just flip
  // `enabled`: with overlay="disabled" the surface is unmapped. The bar widget
  // owns that rule, so the panel asks it instead of keeping a second copy.
  function toggleSnowfall() {
    if (root.hostWidget && typeof root.hostWidget.toggleSnowfall === "function") {
      root.hostWidget.toggleSnowfall()
      return
    }
    if (root.cfg.enabled && root.cfg.overlay === "passive") root.patch({ enabled: false })
    else root.patch({ enabled: true, overlay: "passive" })
  }

  // Object literals cannot use a variable property name here, so build the
  // one-key patch explicitly.
  function cycleSetting(key, options) {
    var i = options.indexOf(root.cfg[key])
    var change = ({})
    change[key] = options[(i + 1) % options.length]
    root.patch(change)
  }

  property bool confirmReset: false
  property bool confirmClearSnowmen: false

  function clearSnowmen() {
    if (!confirmClearSnowmen) {
      confirmClearSnowmen = true
      return
    }
    confirmClearSnowmen = false
    if (root.service) root.service.clearSnowmen()
  }

  function resetSettings() {
    if (!confirmReset) {
      confirmReset = true
      return
    }
    confirmReset = false
    root.write(Settings.toEntry(Settings.DEFAULTS, root.moduleName))
  }

  Timer {
    id: confirmTimer
    interval: 4000
    running: root.confirmReset
    onTriggered: root.confirmReset = false
  }

  Timer {
    id: clearConfirmTimer
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
            text: root.snowfallActive ? strings.t("state.on") : strings.t("state.off")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        PanelSeparator { width: parent.width }

        // ---- Overview -----------------------------------------------------
        PanelSectionHeader {
          width: parent.width
          text: strings.t("section.overview")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.snowfall")
          checked: root.snowfallActive
          onClicked: root.toggleSnowfall()
        }

        Item {
          width: parent.width
          height: 38
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("row.surface")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.cfg.overlay === "passive" ? strings.t("value.clickthrough") : strings.t("value.hidden")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.cycleSetting("overlay", ["passive", "disabled"])
          }
        }

        Item {
          width: parent.width
          height: 38
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("row.layer")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.cfg.layer === "behind" ? strings.t("value.behind") : strings.t("value.above")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.cycleSetting("layer", ["behind", "above"])
          }
        }

        Item {
          width: parent.width
          height: 38
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("row.quality")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: strings.t("quality." + root.cfg.quality)
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.cycleSetting("quality", Settings.QUALITIES)
          }
        }

        PanelSeparator { width: parent.width }

        // ---- Behavior -----------------------------------------------------
        PanelSectionHeader {
          width: parent.width
          text: strings.t("section.behavior")
        }

        Toggle {
          width: parent.width
          label: strings.t("row.windowSnow")
          checked: root.cfg.accumulateOnWindows
          onClicked: root.patch({ accumulateOnWindows: !root.cfg.accumulateOnWindows })
        }

        Toggle {
          width: parent.width
          label: strings.t("row.builder")
          checked: root.cfg.builderEnabled
          onClicked: root.patch({ builderEnabled: !root.cfg.builderEnabled })
        }

        Toggle {
          width: parent.width
          label: strings.t("row.adaptive")
          checked: root.cfg.adaptiveQuality
          onClicked: root.patch({ adaptiveQuality: !root.cfg.adaptiveQuality })
        }

        Toggle {
          width: parent.width
          label: strings.t("row.fullscreen")
          checked: root.cfg.pauseOnFullscreen
          onClicked: root.patch({ pauseOnFullscreen: !root.cfg.pauseOnFullscreen })
        }

        PanelSeparator { width: parent.width }

        // ---- Snowmen ------------------------------------------------------
        PanelSectionHeader {
          width: parent.width
          text: strings.t("section.snowmen")
        }

        Item {
          width: parent.width
          height: 38
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("row.builderMode")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service && root.service.builderActive
              ? strings.t("value.exit") : strings.t("value.enter")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: {
              if (!root.service) return
              if (root.service.builderActive) root.service.exitBuilder()
              else root.service.enterBuilder()
              root.close()
            }
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("row.savedSnowmen")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? String(root.service.snowmen.length) : "0"
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: 38
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.confirmClearSnowmen ? strings.t("row.clearConfirm") : strings.t("row.clearSnowmen")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.confirmClearSnowmen ? strings.t("value.confirm") : ""
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.clearSnowmen()
          }
        }

        PanelSeparator { width: parent.width }

        // ---- Diagnostics --------------------------------------------------
        PanelSectionHeader {
          width: parent.width
          text: strings.t("section.diagnostics")
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.mode")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? root.service.mode : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.surfaces")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? String(root.service.surfaceCount) : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.screens")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? String(root.service.screenCount) : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.windows")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? String(root.service.trackedWindows) : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.banks")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? String(root.service.bankCount) : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.state")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? root.service.stateStatus : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
            width: parent.width * 0.55
            horizontalAlignment: Text.AlignRight
          }
        }

        Item {
          width: parent.width
          height: 28
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: strings.t("diag.version")
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.service ? root.service.version : strings.t("diag.unavailable")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        PanelSeparator { width: parent.width }

        // ---- Maintenance --------------------------------------------------
        PanelSectionHeader {
          width: parent.width
          text: strings.t("section.maintenance")
        }

        Item {
          width: parent.width
          height: 38
          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.confirmReset ? strings.t("row.resetConfirm") : strings.t("row.reset")
            color: Commons.Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            textFormat: Text.PlainText
            text: root.confirmReset ? strings.t("value.confirm") : ""
            color: Commons.Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.resetSettings()
          }
        }
      }
    }
  }
}
