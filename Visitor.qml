import QtQuick

// Something that walks or flies through a scene: painted by a function from
// draw.js each frame it moves, and clickable.
Item {
  id: root

  property var scene: null
  property var painter: null
  signal tapped()

  visible: false

  function paint() { canvas.requestPaint() }

  Canvas {
    id: canvas
    anchors.fill: parent
    renderTarget: Canvas.FramebufferObject
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (root.painter) root.painter(ctx, width, height, root.scene ? root.scene.clock : 0)
    }
  }

  MouseArea {
    anchors.fill: parent
    cursorShape: Qt.PointingHandCursor
    onClicked: root.tapped()
  }
}
