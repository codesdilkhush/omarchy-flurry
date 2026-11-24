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

  // A labelled switch for one of the service's flags (Service.setFlag).
  component FlagRow: RowLayout {
    property var svc: null
    property string flag: ""
    property string label: ""
    Layout.fillWidth: true
    Text {
      Layout.fillWidth: true
      text: parent.label
      elide: Text.ElideRight
      color: Commons.Color.popups.text
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }
    ToggleSwitch {
      checked: parent.svc ? !!parent.svc.saved[parent.flag] : false
      onToggled: parent.svc.setFlag(parent.flag, !checked)
    }
  }

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
        Text { Layout.fillWidth: true; text: "Snow plow (clears deep ground snow)"; color: Commons.Color.popups.text; font.family: Style.font.family; font.pixelSize: Style.font.body }
        ToggleSwitch { checked: root.service ? root.service.saved.plow : true; onToggled: root.service.setPlow(!checked) }
      }
      RowLayout {
        Layout.fillWidth: true
        Text { Layout.fillWidth: true; text: "Snowballs"; color: Commons.Color.popups.text; font.family: Style.font.family; font.pixelSize: Style.font.body }
        ToggleSwitch { checked: root.service ? root.service.saved.snowballs : true; onToggled: root.service.setSnowballs(!checked) }
      }
      RowLayout {
        Layout.fillWidth: true
        Text { Layout.fillWidth: true; text: "Halve on battery"; color: Commons.Color.popups.text; font.family: Style.font.family; font.pixelSize: Style.font.body }
        ToggleSwitch { checked: root.service ? root.service.saved.batterySaver : true; onToggled: root.service.setBatterySaver(!checked) }
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.labelGap
        Button {
          Layout.fillWidth: true
          bordered: true
          text: "Shake"
          tooltipText: "Shake the snow globe"
          enabled: root.service && root.service.saved.shake
          onClicked: { root.close(); root.service.shakeAll() }
        }
        Button {
          Layout.fillWidth: true
          bordered: true
          visible: root.service && root.service.saved.ornamentStyles.length > 1
          text: root.service ? "Baubles: " + root.service.saved.ornamentStyle : ""
          tooltipText: "Bauble finish for new baubles (golden snowflakes unlock more)"
          onClicked: root.service.nextOrnamentStyle()
        }
      }

      PanelSectionHeader { text: "Seasons and surprises" }
      FlagRow { svc: root.service; flag: "dayCycle"; label: "Melting, icicles, night glaze" }
      FlagRow { svc: root.service; flag: "seasons"; label: "Spring at Nowruz" }
      FlagRow { svc: root.service; flag: "newYear"; label: "New Year fireworks" }
      FlagRow { svc: root.service; flag: "surprises"; label: "A robin, a hare, a golden flake" }
      FlagRow { svc: root.service; flag: "windGusts"; label: "Wind from moving windows" }
      FlagRow { svc: root.service; flag: "writing"; label: "Write in snow (Ctrl+drag)" }
      FlagRow { svc: root.service; flag: "themeSync"; label: "Theme colours" }
      FlagRow { svc: root.service; flag: "liveWeather"; label: "Live weather" }
      TextField {
        id: cityField
        Layout.fillWidth: true
        visible: root.service && root.service.saved.liveWeather
        placeholderText: root.service && root.service.saved.weatherPlace ? root.service.saved.weatherPlace : "City, for the weather…"
        maximumLength: 80
        onAccepted: { if (text.trim() !== "") { root.service.setWeatherCity(text); text = "" } }
      }

      RowLayout {
        Layout.fillWidth: true
        Text { text: "Calm"; color: Commons.Color.popups.text; font.family: Style.font.family; font.pixelSize: Style.font.body }
        Item { Layout.fillWidth: true }
        ButtonGroup {
          options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "work", label: "Work hours" }]
          value: root.service ? root.service.saved.calm : "off"
          onChanged: function(v) { root.service.setCalm(v) }
        }
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

      FlagRow {
        svc: root.service
        flag: "throwToFriends"
        visible: root.service && root.service.friends.length > 0
        label: root.service && root.service.throwFriend ? "Throw snowballs to " + root.service.throwFriend.name : "Throw snowballs to friends"
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
