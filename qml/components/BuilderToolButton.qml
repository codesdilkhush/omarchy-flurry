import QtQuick
import qs.Commons
import qs.Commons as Commons

// Compact HUD button used by the snowman builder. Stateless: the caller owns
// `active` and reacts to `clicked()`.
Item {
  id: button

  property string label: ""
  property bool active: false
  signal clicked()

  Accessible.role: Accessible.Button
  Accessible.name: button.label
  Accessible.checkable: true
  Accessible.checked: button.active

  activeFocusOnTab: true
  Keys.onReturnPressed: button.clicked()
  Keys.onSpacePressed: button.clicked()

  implicitWidth: labelText.implicitWidth + Style.space(16)
  implicitHeight: Math.max(26, labelText.implicitHeight + Style.space(8))

  Rectangle {
    anchors.fill: parent
    radius: Style.cornerRadius
    color: button.active ? Qt.rgba(0.45, 0.65, 0.9, 0.35) : Qt.rgba(1, 1, 1, 0.06)
    border.color: button.active ? Qt.rgba(0.6, 0.8, 1, 0.6) : Qt.rgba(1, 1, 1, 0.1)
    border.width: 1
  }

  Text {
    id: labelText
    anchors.centerIn: parent
    textFormat: Text.PlainText
    text: button.label
    color: Commons.Color.foreground
    font.family: Style.font.family
    font.pixelSize: Style.font.caption
  }

  MouseArea {
    anchors.fill: parent
    cursorShape: Qt.PointingHandCursor
    onClicked: button.clicked()
  }
}
