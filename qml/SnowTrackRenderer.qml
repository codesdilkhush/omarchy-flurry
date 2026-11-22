import QtQuick

// Pressed-snow impressions left by the rolling ball and the bulldozer.
//
// There is one bounded store per monitor (SnowTracks.js) shared by both actors;
// this canvas only reads it. It sits above the bank layer and below the falling
// flakes and vehicle, so an impression reads as dented snow rather than a mark
// painted on the glass. A fading track also flattens slightly, which reads as
// fresh snowfall slowly filling it back in.
//
// Repaints happen only when MonitorScene's existing frame loop asks for them;
// this component owns no timer and no per-flake QML objects.
Canvas {
  id: trackView

  required property var simulation

  // Default Canvas.Image backing: transparent, portable, no stale FBO texture.
  antialiasing: true

  onAvailableChanged: if (available) trackView.requestPaint()
  onVisibleChanged: if (visible) trackView.requestPaint()

  onPaint: {
    var ctx = getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    var sim = trackView.simulation
    var tracks = sim && sim.tracks
    if (!tracks || !tracks.capacity) return

    for (var i = 0; i < tracks.capacity; i++) {
      var strength = tracks.strength[i]
      if (!(strength > 0.02)) continue
      var x = tracks.x[i]
      var r = tracks.radius[i]
      if (!(r > 0) || x < -r || x > width + r) continue
      var y = tracks.y[i]
      // A fresh print is a soft hollow: dark in the middle, lighter along the
      // upper lip. As strength falls the hollow shallows and spreads, like snow
      // drifting over an old footprint.
      var rx = r * (0.9 + (1 - strength) * 0.2)
      var ry = r * (0.18 + 0.16 * strength)

      ctx.globalAlpha = Math.min(0.26, 0.10 + strength * 0.15)
      ctx.fillStyle = "#5b7590"
      drawEllipse(ctx, x, y + 1.2, rx, ry)
      ctx.fill()

      ctx.globalAlpha = Math.min(0.22, 0.06 + strength * 0.14)
      ctx.fillStyle = "#ffffff"
      drawEllipse(ctx, x, y - ry * 0.55, rx * 0.86, ry * 0.5)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // Context2D.ellipse() is not available in every Quickshell Qt build; build the
  // same shape from arc() plus a transform, as SnowPlowRenderer does.
  function drawEllipse(ctx, cx, cy, rx, ry) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, 6.2831853)
    ctx.restore()
  }
}
