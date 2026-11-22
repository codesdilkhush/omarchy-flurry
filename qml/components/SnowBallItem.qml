import QtQuick

// The snowball being rolled. Centered on (cx, cy); grows with `radius` and
// shows a faint texture that turns with `spin`, so dragging reads as rolling.
Canvas {
  id: ball

  property real radius: 5
  property real spin: 0
  property real cx: 0
  property real cy: 0
  // 0 = freshly gathered, 1 = packed by rolling. Packed snow reads denser.
  property real compaction: 0

  width: Math.ceil(radius * 2 + 6)
  height: width
  x: cx - width / 2
  y: cy - height / 2

  // Default Canvas.Image backing: no black texture on transparent overlays.
  antialiasing: true

  onRadiusChanged: requestPaint()
  onSpinChanged: requestPaint()
  onCompactionChanged: requestPaint()
  onWidthChanged: requestPaint()
  onAvailableChanged: if (available) requestPaint()

  onPaint: {
    var ctx = getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    var r = ball.radius
    var mid = width / 2

    // A packed ball reads denser: the highlight tightens and the rim darkens
    // as compaction rises, while the silhouette is already slightly smaller
    // (see SnowRoll.visibleRadius). No extra canvas or timer is involved.
    var packed = ball.compaction
    var glow = 0.34 - packed * 0.14
    var gradient = ctx.createRadialGradient(mid - r * glow, mid - r * (glow + 0.06),
      r * 0.06, mid, mid, r)
    gradient.addColorStop(0, "#ffffff")
    gradient.addColorStop(0.62 + packed * 0.08, "#f6faff")
    gradient.addColorStop(1, packed > 0.5 ? "#c5d2df" : "#d3dfea")
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(mid, mid, r, 0, 6.2831853)
    ctx.fill()

    // Two faint arcs, rotated by the rolling angle. Packed snow shows a
    // tighter, higher-contrast compression band instead of loose flakes.
    ctx.strokeStyle = packed > 0.5
      ? "rgba(140, 165, 190, 0.32)" : "rgba(165, 190, 210, 0.24)"
    ctx.lineWidth = Math.max(0.7, r * (0.035 + packed * 0.015))
    ctx.lineCap = "round"
    for (var k = 0; k < 2; k++) {
      var a = ball.spin + k * 3.1415926
      ctx.beginPath()
      ctx.arc(mid, mid, r * (0.62 + packed * 0.08), a, a + 1.1 - packed * 0.2)
      ctx.stroke()
    }

    ctx.strokeStyle = "rgba(130, 155, 180, " + (0.26 + packed * 0.12) + ")"
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.arc(mid, mid, r, 0, 6.2831853)
    ctx.stroke()
  }
}
