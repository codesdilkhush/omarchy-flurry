import QtQuick
import qs.Commons
import qs.Commons as Commons

// One clickable settings row: a label on the left, its current value on the
// right. Stateless: the caller owns `value` and reacts to `clicked()`.
Item {
  id: row

  property string label: ""
  property string value: ""
  // Caption-sized, non-interactive rows are used for read-only diagnostics.
  property bool compact: false
  property bool interactive: true
  signal clicked()

  implicitHeight: row.compact ? 28 : 38
  height: implicitHeight

  Accessible.role: row.interactive ? Accessible.Button : Accessible.StaticText
  Accessible.name: row.value !== "" ? row.label + ": " + row.value : row.label

  Text {
    id: labelText
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: Math.min(implicitWidth, parent.width * 0.5)
    elide: Text.ElideRight
    textFormat: Text.PlainText
    text: row.label
    color: row.compact ? Commons.Color.muted : Commons.Color.foreground
    font.family: Style.font.family
    font.pixelSize: row.compact ? Style.font.caption : Style.font.body
  }

  Text {
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    width: parent.width - labelText.width - Style.space(12)
    horizontalAlignment: Text.AlignRight
    elide: Text.ElideRight
    textFormat: Text.PlainText
    text: row.value
    color: row.compact ? Commons.Color.foreground : Commons.Color.muted
    font.family: Style.font.family
    font.pixelSize: row.compact ? Style.font.caption : Style.font.body
  }

  MouseArea {
    anchors.fill: parent
    enabled: row.interactive
    cursorShape: row.interactive ? Qt.PointingHandCursor : Qt.ArrowCursor
    onClicked: row.clicked()
  }
}
