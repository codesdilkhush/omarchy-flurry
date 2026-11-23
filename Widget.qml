import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// The bar icon. Click for the menu, right-click to turn the weather on or
// off, scroll to change it.
BarWidget {
  id: root
  moduleName: "itscallssh.flurry"

  readonly property var service: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor(moduleName) : null
  readonly property bool on: !!service && service.isOn
  readonly property string effect: service ? service.effect : "snow"

  // Material Design glyphs from the Nerd Font every Omarchy theme uses.
  readonly property var glyphs: ({
    snow: 0xF0598, leaves: 0xF032A, starfall: 0xF0594, rain: 0xF0596, sakura: 0xF024A, fireflies: 0xF06E8
  })
  readonly property var names: ({
    snow: "Snow", leaves: "Leaves", starfall: "Starfall", rain: "Rain", sakura: "Sakura", fireflies: "Fireflies"
  })
  function glyph(name) { return String.fromCodePoint(glyphs[name] || 0xF0598) }

  property bool popupOpen: false
  function close() { popupOpen = false }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.glyph(root.effect)
    dimmed: !root.on
    active: root.popupOpen
    tooltipText: root.on ? "Flurry: " + root.names[root.effect] : "Flurry: off"
    onPressed: function(b) {
      if (!root.service) return
      if (b === Qt.RightButton) root.service.toggle()
      else root.popupOpen = !root.popupOpen
    }
    onWheelMoved: function(delta) { if (root.service) root.service.nextEffect(delta > 0 ? -1 : 1) }
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    open: root.popupOpen && !!root.service
    contentWidth: Style.space(320)
    contentHeight: fittedContentHeight(body.implicitHeight)

    ColumnLayout {
      id: body
      anchors { left: parent.left; right: parent.right; top: parent.top }
      spacing: Style.spacing.panelGap

      RowLayout {
        Layout.fillWidth: true
        Text {
          Layout.fillWidth: true
          text: "Flurry"
          color: Commons.Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.heading
          font.bold: true
        }
        ToggleSwitch {
          checked: root.on
          onToggled: root.service.toggle()
        }
      }

      GridLayout {
        Layout.fillWidth: true
        columns: 3
        rowSpacing: Style.spacing.labelGap
        columnSpacing: Style.spacing.labelGap
        Repeater {
          model: root.service ? root.service.effects : []
          delegate: Button {
            required property string modelData
            Layout.fillWidth: true
            iconText: root.glyph(modelData)
            text: root.names[modelData]
            selected: root.on && root.effect === modelData
            bordered: true
            onClicked: root.service.setEffect(modelData)
          }
        }
      }

      PanelSectionHeader { text: "Amount" }
      PanelSlider {
        Layout.fillWidth: true
        bar: root.bar
        minimum: 0.25
        maximum: 2
        step: 0.25
        value: root.service ? root.service.intensity : 1
        onReleased: function(v) { root.service.setIntensity(v) }
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.labelGap
        Button {
          Layout.fillWidth: true
          bordered: true
          text: "Decorate"
          onClicked: { root.close(); root.service.startDecorating() }
        }
        Button {
          Layout.fillWidth: true
          bordered: true
          text: "Call Santa"
          onClicked: { root.close(); root.service.summonSanta() }
        }
      }

      RowLayout {
        Layout.fillWidth: true
        Text { Layout.fillWidth: true; text: "Santa and the Yeti"; color: Commons.Color.popups.text; font.family: Style.font.family; font.pixelSize: Style.font.body }
        ToggleSwitch { checked: root.service ? root.service.saved.visitors : true; onToggled: root.service.setVisitors(!checked) }
      }
      RowLayout {
        Layout.fillWidth: true
        Text { Layout.fillWidth: true; text: "Halve on battery"; color: Commons.Color.popups.text; font.family: Style.font.family; font.pixelSize: Style.font.body }
        ToggleSwitch { checked: root.service ? root.service.saved.batterySaver : true; onToggled: root.service.setBatterySaver(!checked) }
      }

      PanelSectionHeader { text: "Friends" }

      Button {
        Layout.fillWidth: true
        visible: root.service && !root.service.identity
        bordered: true
        text: "Set up friends"
        onClicked: root.service.setupFriends("")
      }

      RowLayout {
        Layout.fillWidth: true
        visible: root.service && !!root.service.identity
        spacing: Style.spacing.labelGap
        Button { Layout.fillWidth: true; bordered: true; text: "Copy my code"; onClicked: root.service.copyFriendCode() }
        Button { Layout.fillWidth: true; bordered: true; text: "Add from clipboard"; onClicked: root.service.addFriendFromClipboard() }
      }

      Repeater {
        model: root.service ? root.service.friends : []
        delegate: RowLayout {
          required property var modelData
          Layout.fillWidth: true
          Text {
            Layout.fillWidth: true
            text: modelData.name
            elide: Text.ElideRight
            color: Commons.Color.popups.text
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          Button {
            text: "Send note"
            enabled: noteField.text.trim() !== ""
            onClicked: { if (root.service.sendNote(modelData.id, noteField.text)) noteField.text = "" }
          }
          Button {
            iconText: String.fromCodePoint(0xF0156)
            tooltipText: "Remove " + modelData.name
            onClicked: root.service.removeFriend(modelData.id)
          }
        }
      }

      TextField {
        id: noteField
        Layout.fillWidth: true
        visible: root.service && root.service.friends.length > 0
        placeholderText: "A note for a friend…"
        maximumLength: 280
      }

      Text {
        Layout.fillWidth: true
        visible: root.service && !!root.service.identity && root.service.friends.length === 0
        wrapMode: Text.Wrap
        text: "Swap codes with a friend, then right-click a snowman or tree to send it on the little train."
        color: Qt.darker(Commons.Color.popups.text, 1.4)
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }
    }
  }
}
