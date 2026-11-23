import QtQuick

// The little snow-eating bulldozer, drawn in one Canvas pass like the snow and
// the tracks. No QML object per wheel or flake: the model owns all motion state
// (position, travel, scoop cycle, bounce, load) and this component only reads
// it when MonitorScene's existing frame loop requests a repaint.
Canvas {
  id: plowView

  required property var simulation

  // Default Canvas.Image backing keeps the vehicle layer alpha-correct.
  antialiasing: true

  // Idle gating, as in SnowTrackRenderer: the vehicle is off-screen most of the
  // time, so the canvas only repaints while it is visible, plus one clearing pass.
  property bool hasInk: false
  property int paintCount: 0

  function wantsPaint() {
    var sim = plowView.simulation
    var p = sim && sim.plow
    var visibleNow = p && p.state !== "idle" && p.state !== "unloading"
    return plowView.hasInk || visibleNow === true
  }

  onAvailableChanged: if (available) plowView.requestPaint()
  onVisibleChanged: if (visible) plowView.requestPaint()

  onPaint: {
    var ctx = getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    plowView.paintCount++
    plowView.hasInk = false
    var sim = plowView.simulation
    if (!sim || !sim.plow) return
    var p = sim.plow
    // Idle and unloading happen off-screen; nothing to draw there.
    if (p.state === "idle" || p.state === "unloading") return
    plowView.hasInk = true

    ctx.save()
    ctx.translate(p.x, p.y + p.bounce)

    var dir = p.dir < 0 ? -1 : 1
    ctx.scale(dir, 1)

    // Contact shadow on the snow.
    ctx.globalAlpha = 0.22
    ctx.fillStyle = "#263449"
    drawEllipse(ctx, 0, 2, 21, 3.5)
    ctx.fill()
    ctx.globalAlpha = 1

    // Treads. Their spoke angle comes from travelled distance, not a timer.
    // Dark rubber with a warm hub matches the little yellow dozer in the
    // reference clip rather than the old grey/blue snow-cat look.
    var spin = p.travel * 0.32
    for (var side = -1; side <= 1; side += 2) {
      var wx = side * 10
      ctx.fillStyle = "#26313d"
      ctx.beginPath()
      ctx.arc(wx, -4, 4.8, 0, 6.2831853)
      ctx.fill()
      ctx.fillStyle = "#ffb91f"
      ctx.beginPath()
      ctx.arc(wx, -4, 2.1, 0, 6.2831853)
      ctx.fill()
      ctx.strokeStyle = "#e8eef5"
      ctx.lineWidth = 0.9
      ctx.beginPath()
      for (var spoke = 0; spoke < 3; spoke++) {
        var a = spin + spoke * 2.0943951
        ctx.moveTo(wx, -4)
        ctx.lineTo(wx + Math.cos(a) * 3.4, -4 + Math.sin(a) * 3.4)
      }
      ctx.stroke()
    }

    // Chassis, cab and beacon — the bright orange silhouette from the video.
    ctx.fillStyle = "#d98a12"
    roundedRect(ctx, -15, -12, 27, 8, 2)
    ctx.fill()
    ctx.fillStyle = "#ffb01f"
    roundedRect(ctx, -15, -16, 27, 7, 2.5)
    ctx.fill()
    ctx.fillStyle = "#ffc43d"
    roundedRect(ctx, -10, -23, 13, 9, 2.5)
    ctx.fill()
    ctx.strokeStyle = "#e29412"
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.fillStyle = "#bfe3f7"
    roundedRect(ctx, -8, -21, 8.5, 5.4, 1.4)
    ctx.fill()
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)"
    ctx.beginPath()
    ctx.moveTo(-8, -21)
    ctx.lineTo(-3.5, -21)
    ctx.lineTo(-8, -15.6)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = "#ff8a1f"
    roundedRect(ctx, -5.4, -25.5, 2.8, 2.4, 0.8)
    ctx.fill()
    ctx.fillStyle = "#fff6d8"
    ctx.beginPath()
    ctx.arc(10, -13, 1.4, 0, 6.2831853)
    ctx.fill()

    // Carried snow: a soft mound whose height tracks the scoop's load.
    var fill = p.capacity > 0 ? Math.min(1, Math.max(0, p.load / p.capacity)) : 0
    if (fill > 0.01) {
      ctx.fillStyle = "#ffffff"
      ctx.beginPath()
      ctx.moveTo(-14, -16)
      ctx.quadraticCurveTo(-8, -16 - fill * 11, -1, -16 - fill * 5)
      ctx.lineTo(-1, -16)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 0.35
      ctx.fillStyle = "#bcd2e6"
      drawEllipse(ctx, -7, -16, 7, 1.6)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // Front blade with an opening/closing snow-eating mouth.
    var mouth = p.state === "collecting" ? (0.5 + 0.5 * Math.sin(p.scoopPhase)) : 0.15
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.moveTo(11, -15)
    ctx.quadraticCurveTo(18 + mouth * 3, -17, 20 + mouth * 3, -10)
    ctx.lineTo(20 + mouth * 3, 1)
    ctx.lineTo(11, -1)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = "#c8d8e8"
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = "#e29412"
    ctx.fillRect(16 + mouth * 3, -12 + mouth * 3, 2.2, 11 - mouth * 5)

    // Snow gathering just ahead of the scoop.
    if (p.frontPile > 0.02) {
      ctx.globalAlpha = Math.min(0.85, p.frontPile)
      ctx.fillStyle = "#ffffff"
      ctx.beginPath()
      ctx.moveTo(18, 0)
      ctx.quadraticCurveTo(22, -3 - p.frontPile * 5, 27, 0)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }

  // Soft shadows and snow mounds without relying on Context2D.ellipse(), which
  // is not part of every Quickshell/Qt Canvas build.
  function drawEllipse(ctx, cx, cy, rx, ry) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, 6.2831853)
    ctx.restore()
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }
}
