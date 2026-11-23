import QtQuick
import "lib/draw.js" as Draw

// A tree, snowman, gift or note on the desktop. It stands where its saved
// place says, rides its window when it has one, and can be dragged, sent to
// a friend, or decorated.
Item {
  id: root

  property var scene: null
  property string kind: "snowman"
  property var item: null

  readonly property real baseW: kind === "tree" ? 150 : (kind === "snowman" ? 74 : 44)
  readonly property real baseH: kind === "tree" ? 215 : (kind === "snowman" ? 128 : (kind === "gift" && item && item.kind === "note" ? 34 : 44))
  readonly property real size: item && item.size ? item.size : 1
  width: baseW * size
  height: baseH * size

  readonly property var feet: scene && item ? scene.feetFor(item.place) : null
  property bool dragging: false
  property real dragX: 0
  property real dragY: 0

  x: dragging ? dragX : (feet ? feet.x - width / 2 : 0)
  y: dragging ? dragY : (feet ? feet.y - height + (kind === "tree" ? 2 : 1) : 0)
  visible: dragging || feet !== null

  // A freshly planted tree grows; a fresh snowman is rolled ball by ball.
  property real growth: 1
  Component.onCompleted: {
    if (scene) scene.addTouchable(root)
    var age = item && item.planted ? Date.now() - item.planted : 1e9
    if ((kind === "tree" && age < 4000) || (kind === "snowman" && !wasSeen())) { growth = 0; grow.start() }
  }
  Component.onDestruction: if (scene) scene.removeTouchable(root)

  // Snowmen roll in only when they are new this session.
  function wasSeen() {
    var seen = scene ? (scene.seenIds || {}) : {}
    var known = !!seen[item.id]
    if (scene) { var next = Object.assign({}, seen); next[item.id] = true; scene.seenIds = next }
    return known || (scene ? scene.clock < 2 : true)
  }

  NumberAnimation { id: grow; target: root; property: "growth"; from: 0; to: 1; duration: root.kind === "tree" ? 2400 : 1300; easing.type: Easing.OutCubic }
  onGrowthChanged: canvas.requestPaint()
  onItemChanged: canvas.requestPaint()

  // Tree lights twinkle.
  readonly property bool twinkles: kind === "tree" && item && item.ornaments.some(function(o) { return o.kind === "light" })
  Timer { interval: 180; repeat: true; running: root.twinkles && root.visible; onTriggered: canvas.requestPaint() }

  Canvas {
    id: canvas
    anchors.fill: parent
    renderTarget: Canvas.FramebufferObject
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (!root.item) return
      if (root.kind === "tree") Draw.tree(ctx, width, height, { growth: root.growth, star: root.item.star, ornaments: root.item.ornaments }, Date.now() / 1000)
      else if (root.kind === "snowman") Draw.snowman(ctx, width, height, { built: root.growth, scarf: root.item.scarf })
      else if (root.item.kind === "note") Draw.letter(ctx, width, height)
      else Draw.gift(ctx, width, height, root.item.color)
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    cursorShape: root.dragging ? Qt.ClosedHandCursor : Qt.OpenHandCursor
    property real pressX: 0
    property real pressY: 0
    property bool moved: false

    onPressed: function(m) {
      pressX = m.x; pressY = m.y; moved = false
      if (root.scene) root.scene.menuFor = null
    }
    onPositionChanged: function(m) {
      if (!(m.buttons & Qt.LeftButton)) return
      if (!moved && Math.abs(m.x - pressX) + Math.abs(m.y - pressY) < 6) return
      if (!moved) { root.dragX = root.x; root.dragY = root.y; root.dragging = true; moved = true }
      root.dragX += m.x - pressX
      root.dragY += m.y - pressY
    }
    onReleased: function(m) {
      if (!root.dragging) return
      var fx = root.dragX + root.width / 2, fy = root.dragY + root.height
      root.scene.service.moveItem(root.kindKey(), root.item.id, root.scene.placeAt(root.kind, fx, fy))
      root.dragging = false
    }
    onClicked: function(m) {
      if (moved) return
      var p = root.mapToItem(null, m.x, m.y)
      if (m.button === Qt.RightButton) { root.scene.openMenu(root.kindKey(), root.item.id, p.x, p.y); return }
      root.click(m.x, m.y, p)
    }
  }

  function kindKey() { return kind === "gift" ? "gift" : kind }

  function click(lx, ly, p) {
    var tool = scene.decorating ? scene.tool : ""
    if (kind === "tree" && (tool === "bauble" || tool === "light" || tool === "candy" || tool === "star")) {
      if (tool === "star") { scene.service.decorateTree(item.id, { kind: "star" }); return }
      var at = Draw.ornamentAt(width, height, lx, ly)
      if (at) scene.service.decorateTree(item.id, { kind: tool, u: at.u, v: at.v })
      return
    }
    if (tool === "erase") { scene.service.removeItem(kindKey(), item.id); return }
    if (kind === "gift") {
      scene.service.openGift(item.id)
      var who = item.from ? "From " + item.from + ": " : ""
      scene.say(who + (item.note || "A little something for you."), p.x, root.y)
      return
    }
    scene.openMenu(kindKey(), item.id, p.x, p.y)
  }
}
