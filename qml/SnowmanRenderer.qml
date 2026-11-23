import QtQuick

// Persistent snowmen for one monitor, drawn in one revision-gated paint pass.
//
// Snowmen are not per-frame particles, but a single Canvas still keeps the
// scene graph small: at most MAX_SNOWMEN records with a handful of balls each.
// All artwork is original vector drawing — no external images or assets.
Canvas {
  id: renderer

  required property var snowmen
  required property int revision
  property string monitorName: ""

  // Default Canvas.Image backing keeps the layer transparent on every backend.
  antialiasing: true

  onRevisionChanged: renderer.requestPaint()
  onMonitorNameChanged: renderer.requestPaint()
  // A Canvas texture lost to a scene-graph reset comes back empty; the snowmen
  // only repaint on a model change, so repaint when the canvas returns.
  onAvailableChanged: if (available) renderer.requestPaint()
  onVisibleChanged: if (visible) renderer.requestPaint()

  onPaint: {
    var ctx = getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    var list = renderer.snowmen || []
    for (var i = 0; i < list.length; i++) {
      var snowman = list[i]
      if (snowman.monitor !== renderer.monitorName) continue
      drawSnowman(ctx, snowman)
    }
  }

  function drawSnowman(ctx, snowman) {
    var balls = snowman.balls || []
    for (var i = 0; i < balls.length; i++) {
      var ball = balls[i]
      drawBall(ctx, ball.x, ball.y, ball.r)
    }
    for (var d = 0; d < (snowman.decorations || []).length; d++)
      drawDecoration(ctx, snowman.decorations[d], balls)
  }

  function drawBall(ctx, x, y, r) {
    var gradient = ctx.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.08, x, y, r)
    gradient.addColorStop(0, "#ffffff")
    gradient.addColorStop(0.65, "#f4f8fc")
    gradient.addColorStop(1, "#c9d6e2")
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 6.2831853)
    ctx.fill()
    ctx.strokeStyle = "rgba(120, 145, 170, 0.35)"
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  function drawDecoration(ctx, decoration, balls) {
    var index = decoration.ballIndex
    if (index < 0 || index >= balls.length) return
    var ball = balls[index]
    var scale = decoration.scale || 1
    var x = ball.x + decoration.dx * scale
    var y = ball.y + decoration.dy * scale

    if (decoration.type === "carrot") {
      var length = ball.r * 1.15 * scale
      ctx.fillStyle = "#ef8b32"
      ctx.beginPath()
      ctx.moveTo(x + ball.r * 0.7, y - ball.r * 0.12 * scale)
      ctx.lineTo(x + ball.r * 0.7 + length, y + ball.r * 0.04 * scale)
      ctx.lineTo(x + ball.r * 0.7, y + ball.r * 0.18 * scale)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = "rgba(150, 70, 20, 0.5)"
      ctx.lineWidth = 0.6
      ctx.stroke()
    } else if (decoration.type === "eyes") {
      ctx.fillStyle = "#2b3440"
      var eyeY = y - ball.r * 0.32 * scale
      var eyeX = ball.r * 0.32 * scale
      ctx.beginPath()
      ctx.arc(x - eyeX, eyeY, Math.max(1.6, ball.r * 0.075 * scale), 0, 6.2831853)
      ctx.arc(x + eyeX, eyeY, Math.max(1.6, ball.r * 0.075 * scale), 0, 6.2831853)
      ctx.fill()
    } else if (decoration.type === "arms") {
      ctx.strokeStyle = "#7c5a3c"
      ctx.lineWidth = Math.max(1.4, 2.2 * scale)
      ctx.lineCap = "round"
      for (var side = -1; side <= 1; side += 2) {
        var rootX = x + side * ball.r * 0.85
        var tipX = x + side * ball.r * 1.9 * scale
        var tipY = y - ball.r * 0.45 * scale
        ctx.beginPath()
        ctx.moveTo(rootX, y)
        ctx.lineTo(tipX, tipY)
        ctx.moveTo(tipX - side * ball.r * 0.35, tipY + ball.r * 0.12)
        ctx.lineTo(tipX - side * ball.r * 0.05, tipY - ball.r * 0.25)
        ctx.stroke()
      }
    } else if (decoration.type === "hat") {
      ctx.fillStyle = "#29313c"
      var brim = ball.r * 1.15 * scale
      ctx.fillRect(x - brim, y - ball.r * 0.95 * scale, brim * 2, ball.r * 0.16 * scale)
      ctx.fillRect(x - ball.r * 0.62 * scale, y - ball.r * 1.9 * scale,
        ball.r * 1.24 * scale, ball.r * 0.95 * scale)
    } else if (decoration.type === "scarf") {
      ctx.fillStyle = "#b4473f"
      ctx.fillRect(x - ball.r * 0.95 * scale, y + ball.r * 0.68 * scale,
        ball.r * 1.9 * scale, ball.r * 0.26 * scale)
      ctx.fillRect(x + ball.r * 0.45 * scale, y + ball.r * 0.8 * scale,
        ball.r * 0.24 * scale, ball.r * 0.9 * scale)
    } else if (decoration.type === "buttons") {
      ctx.fillStyle = "#2b3440"
      for (var b = 0; b < 3; b++) {
        ctx.beginPath()
        ctx.arc(x, y + (b - 1) * ball.r * 0.45 * scale,
          Math.max(1.5, ball.r * 0.06 * scale), 0, 6.2831853)
        ctx.fill()
      }
    } else if (decoration.type === "mouth") {
      ctx.fillStyle = "#3a424c"
      for (var m = -2; m <= 2; m++) {
        ctx.beginPath()
        ctx.arc(x + m * ball.r * 0.16 * scale,
          y + ball.r * (0.42 + Math.abs(m) * 0.08) * scale,
          Math.max(1, ball.r * 0.035 * scale), 0, 6.2831853)
        ctx.fill()
      }
    }
  }
}
