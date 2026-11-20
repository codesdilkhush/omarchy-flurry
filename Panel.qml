import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "js/Settings.js" as Settings

// The settings popup. Every row is a click-to-cycle control rather than a
// widget-kit control, so the panel depends on nothing beyond Style, Color and
// the KeyboardPanel host. Writes go through the bar widget, which owns the
// inline shell.json entry.
Panel {
  id: root
  moduleName: "snowglobe"
  ipcTarget: ""
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null

  readonly property var cfg: Settings.normalize(settings)

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

  function cycleQuality() {
    var order = Settings.QUALITIES
    var i = order.indexOf(root.cfg.quality)
    root.patch({ quality: order[(i + 1) % order.length] })
  }

  function cycleLayer() {
    root.patch({ layer: root.cfg.layer === "behind" ? "above" : "behind" })
  }

  KeyboardPanel {
    anchorItem: root.anchorItem
    owner: root.hostWidget ? root.hostWidget : root
    bar: root.bar
    open: root.opened
    centerOnBar: false
    contentWidth: Style.space(320)
    contentHeight: Style.space(252)

    content: Rectangle {
      implicitHeight: Style.space(252)
      color: "transparent"

      Column {
        id: column
        anchors.fill: parent
        anchors.margins: Style.space(14)
        spacing: Style.space(2)

        Text {
          text: "Snowglobe"
          color: Commons.Color.foreground
          font.pixelSize: Style.font.body
          font.bold: true
        }

        Item { width: 1; height: Style.space(8) }

        // ---- Snowfall on/off
        Item {
          width: column.width
          height: Style.space(34)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Snowfall"
            color: Commons.Color.foreground
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: root.cfg.enabled && root.cfg.overlay === "passive" ? "On" : "Off"
            color: Commons.Color.muted
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.patch({ enabled: !(root.cfg.enabled && root.cfg.overlay === "passive") })
          }
        }

        // ---- Overlay mode: click-through surface or none at all
        Item {
          width: column.width
          height: Style.space(34)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Surface"
            color: Commons.Color.foreground
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: root.cfg.overlay === "passive" ? "Click-through" : "Hidden"
            color: Commons.Color.muted
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.patch({ overlay: root.cfg.overlay === "passive" ? "disabled" : "passive" })
          }
        }

        // ---- Layer: behind windows or above them
        Item {
          width: column.width
          height: Style.space(34)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Draw"
            color: Commons.Color.foreground
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: root.cfg.layer === "behind" ? "Behind windows" : "Above windows"
            color: Commons.Color.muted
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.cycleLayer()
          }
        }

        // ---- Quality
        Item {
          width: column.width
          height: Style.space(34)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Quality"
            color: Commons.Color.foreground
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: root.cfg.quality
            color: Commons.Color.muted
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.cycleQuality()
          }
        }

        // ---- Snow on windows
        Item {
          width: column.width
          height: Style.space(34)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Snow on window tops"
            color: Commons.Color.foreground
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: root.cfg.accumulateOnWindows ? "On" : "Off"
            color: Commons.Color.muted
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.patch({ accumulateOnWindows: !root.cfg.accumulateOnWindows })
          }
        }

        // ---- Builder
        Item {
          width: column.width
          height: Style.space(34)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Snowman builder"
            color: Commons.Color.foreground
            font.pixelSize: Style.font.body
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: root.cfg.builderEnabled ? "On" : "Off"
            color: Commons.Color.muted
            font.pixelSize: Style.font.body
          }
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.patch({ builderEnabled: !root.cfg.builderEnabled })
          }
        }
      }
    }
  }
}
