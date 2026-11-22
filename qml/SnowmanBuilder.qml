import QtQuick
import qs.Commons
import qs.Commons as Commons
import "components"
import "../js/SnowmanModel.js" as Model
import "../js/State.js" as StateModule
import "../js/SnowRoll.js" as SnowRoll

// Interactive snowman construction surface.
//
// Only instantiated visually while builder mode is active; the host surface
// supplies a real input Region and keyboard focus for exactly this window.
// Every action is delegated to the service, which owns the model and persistence.
//
// Roll tool: press on the snow and drag. A snowball follows the pointer and
// grows as it picks up the snow it passes over (on the ground or on window
// tops); circling over a pile keeps gathering from it. Releasing drops the ball:
// on another ball it stacks, anywhere else it starts a new snowman that rests on
// the surface below.
Item {
  id: builder

  required property var service
  required property string monitorName

  property string tool: "roll"
  property string decorationType: "carrot"
  property var dragging: null
  property string pendingDelete: ""

  // ---- Snowball rolling state --------------------------------------------
  // `roll` is the plain JS object owned by the simulation (see SnowRoll.js);
  // QML cannot observe its fields, so MonitorScene's frame signal calls
  // syncRoll() and copies them into these real properties every tick.
  property var roll: null
  property bool rolling: false
  property real rollX: 0
  property real rollY: 0
  property real rollRadius: 5
  property real rollSpin: 0
  property real rollCompaction: 0
  property int rollStalled: 0

  function syncRoll() {
    var r = builder.roll || builder.service.rollState(builder.monitorName)
    if (!r) {
      builder.roll = null
      builder.rolling = false
      return
    }
    builder.rollX = r.x
    builder.rollY = r.y
    builder.rollRadius = SnowRoll.visibleRadius(r)
    builder.rollSpin = r.spin
    builder.rollCompaction = r.compaction || 0
    builder.rollStalled = r.stalled
  }

  function startRoll(x, y) {
    builder.roll = builder.service.beginRoll(builder.monitorName, x, y)
    builder.rolling = builder.roll !== null
    builder.syncRoll()
  }

  // Drop the ball, or give the snow back if it is too small to be a ball.
  function finishRoll() {
    // Catch up to the release point (sweeping snow on the way) before placing.
    var r = builder.service.finishRoll(builder.monitorName)
    builder.roll = null
    builder.rolling = false
    if (!r) return
    if (SnowRoll.ready(r))
      builder.service.placeRolledBall(builder.monitorName, r.x, r.y, SnowRoll.radiusFor(r.area))
    else if (r.area > 0)
      builder.service.returnSnow(builder.monitorName, r.x, r.y, r.area)
  }

  // Abandon without placing anything; the gathered snow goes back to the pile.
  function abortRoll() {
    var r = builder.service.takeRoll(builder.monitorName)
    builder.roll = null
    builder.rolling = false
    if (r && r.area > 0)
      builder.service.returnSnow(builder.monitorName, r.x, r.y, r.area)
  }

  focus: true
  Keys.onEscapePressed: {
    builder.abortRoll()
    builder.dragging = null
    builder.pendingDelete = ""
    builder.service.exitBuilder()
  }

  Component.onCompleted: builder.forceActiveFocus()
  onVisibleChanged: {
    if (visible) builder.forceActiveFocus()
    else builder.abortRoll()
  }

  function nearestAt(x, y) {
    var list = builder.service.snowmen || []
    var snowman = Model.nearestSnowman(list, builder.monitorName, x, y, undefined)
    if (!snowman) return null
    return { snowman: snowman, index: Model.nearestBall(snowman, x, y) }
  }

  function handlePress(mouse) {
    var hit = nearestAt(mouse.x, mouse.y)

    if (mouse.button === Qt.RightButton) {
      if (!hit) return
      if (builder.pendingDelete === hit.snowman.id) {
        builder.service.deleteSnowman(hit.snowman.id)
        builder.pendingDelete = ""
      } else {
        builder.pendingDelete = hit.snowman.id
      }
      return
    }

    if (mouse.button === Qt.LeftButton && builder.tool === "roll") {
      // Press-and-hold starts a ball; the simulation follows the pointer from
      // here on, so the circle is no longer glued to the cursor.
      builder.startRoll(mouse.x, mouse.y)
    } else if (mouse.button === Qt.LeftButton && builder.tool === "move" && hit) {
      var ball = hit.snowman.balls[hit.index]
      var whole = (mouse.modifiers & Qt.ShiftModifier) !== 0
      builder.dragging = {
        snowmanId: hit.snowman.id,
        ballIndex: hit.index,
        offsetX: mouse.x - ball.x,
        offsetY: mouse.y - ball.y,
        whole: whole
      }
    } else if (mouse.button === Qt.LeftButton && builder.tool === "decorate" && hit) {
      var target = hit.snowman.balls[hit.index]
      builder.service.addDecoration(hit.snowman.id, builder.decorationType,
        hit.index, mouse.x - target.x, mouse.y - target.y)
    } else if (mouse.button === Qt.LeftButton && builder.tool === "delete" && hit) {
      if (builder.pendingDelete === hit.snowman.id) {
        builder.service.deleteBall(hit.snowman.id, hit.index)
        builder.pendingDelete = ""
      } else {
        builder.pendingDelete = hit.snowman.id
      }
    }
  }

  function handleMove(mouse) {
    if (builder.rolling) {
      // Pointer position is a target only: the fixed-step simulation eases the
      // ball towards it and gathers along the way.
      builder.service.setRollTarget(builder.monitorName, mouse.x, mouse.y)
      builder.syncRoll()
      return
    }
    var drag = builder.dragging
    if (!drag) return
    var snowman = Model.findSnowman(builder.service.snowmen || [], drag.snowmanId)
    if (!snowman) return
    var x = mouse.x - drag.offsetX
    var y = mouse.y - drag.offsetY
    if (drag.whole) {
      var ball = snowman.balls[drag.ballIndex]
      if (ball) builder.service.moveSnowman(drag.snowmanId, x - ball.x, y - ball.y)
    } else {
      builder.service.moveBall(drag.snowmanId, drag.ballIndex, x, y)
    }
  }

  function handleRelease(mouse) {
    if (builder.rolling) {
      builder.finishRoll()
      return
    }
    var drag = builder.dragging
    builder.dragging = null
    if (!drag || drag.whole) return
    var list = builder.service.snowmen || []
    var snowman = Model.findSnowman(list, drag.snowmanId)
    if (!snowman || drag.ballIndex >= snowman.balls.length) return
    var ball = snowman.balls[drag.ballIndex]
    var best = -1
    var bestDistance = Infinity
    for (var i = 0; i < snowman.balls.length; i++) {
      if (i === drag.ballIndex) continue
      var other = snowman.balls[i]
      var d = Model.distance(ball.x, ball.y, other.x, other.y)
      if (d < Model.SNAP_DISTANCE + other.r && d < bestDistance) {
        bestDistance = d
        best = i
      }
    }
    if (best >= 0) builder.service.snapBall(drag.snowmanId, drag.ballIndex, best)
  }

  MouseArea {
    z: 1
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    hoverEnabled: false
    cursorShape: builder.rolling ? Qt.ClosedHandCursor
      : (builder.tool === "roll" ? Qt.OpenHandCursor : Qt.ArrowCursor)
    onPressed: function(mouse) { builder.handlePress(mouse) }
    onPositionChanged: function(mouse) { builder.handleMove(mouse) }
    onReleased: function(mouse) {
      if (mouse.button === Qt.LeftButton) builder.handleRelease(mouse)
    }
    // A compositor grab or surface unmap can cancel a press without a release:
    // return the carried snow instead of silently losing it.
    onCanceled: {
      builder.abortRoll()
      builder.dragging = null
    }
  }

  // Leaving builder mode from the panel or IPC also has to finish an in-flight
  // roll cleanly; the service never keeps snow the user cannot see.
  Connections {
    target: builder.service
    function onBuilderActiveChanged() {
      if (!builder.service.builderActive) builder.abortRoll()
    }
  }

  // The ball being rolled, drawn under the pointer while it gathers snow.
  SnowBallItem {
    z: 1
    visible: builder.rolling
    cx: builder.rollX
    cy: builder.rollY
    radius: builder.rollRadius
    spin: builder.rollSpin
    compaction: builder.rollCompaction
  }

  // ---- Builder HUD -------------------------------------------------------
  Rectangle {
    z: 2
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.top: parent.top
    anchors.topMargin: Style.space(12)
    width: Math.max(hudRow.implicitWidth, decorationRow.implicitWidth) + Style.space(24)
    height: hudColumn.implicitHeight + Style.space(16)
    radius: Style.cornerRadius
    color: Qt.rgba(0.06, 0.09, 0.13, 0.92)
    border.color: Qt.rgba(1, 1, 1, 0.12)
    border.width: 1

    Column {
      id: hudColumn
      anchors.centerIn: parent
      spacing: Style.space(8)

      Row {
        id: hudRow
        spacing: Style.space(6)

        BuilderToolButton {
          label: strings.t("builder.tool.roll")
          active: builder.tool === "roll"
          onClicked: { builder.abortRoll(); builder.tool = "roll"; builder.pendingDelete = "" }
        }
        BuilderToolButton {
          label: strings.t("builder.tool.move")
          active: builder.tool === "move"
          onClicked: { builder.tool = "move"; builder.pendingDelete = "" }
        }
        BuilderToolButton {
          label: strings.t("builder.tool.decorate")
          active: builder.tool === "decorate"
          onClicked: { builder.tool = "decorate"; builder.pendingDelete = "" }
        }
        BuilderToolButton {
          label: strings.t("builder.tool.delete")
          active: builder.tool === "delete"
          onClicked: { builder.tool = "delete"; builder.pendingDelete = "" }
        }
        BuilderToolButton {
          label: strings.t("builder.finish")
          active: false
          onClicked: builder.service.exitBuilder()
        }
      }

      Row {
        id: decorationRow
        visible: builder.tool === "decorate"
        spacing: Style.space(6)
        layoutDirection: Qt.LeftToRight

        Repeater {
          model: StateModule.DECORATION_TYPES
          delegate: BuilderToolButton {
            label: strings.t("decoration." + modelData)
            active: builder.decorationType === modelData
            onClicked: builder.decorationType = modelData
          }
        }
      }

      Text {
        textFormat: Text.PlainText
        text: builder.pendingDelete !== "" ? strings.t("builder.confirmDelete")
          : (builder.rolling
            ? strings.t(builder.rollStalled >= 8 ? "builder.noSnow" : "builder.hint.rolling")
            : strings.t("builder.hint." + builder.tool))
        color: Commons.Color.muted
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }
    }
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("../i18n") }
}
