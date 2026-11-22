import QtQuick
import "../js/Simulation.js" as Simulation

// Accumulated snow for one monitor.
//
// This canvas is deliberately separate from the falling-flake canvas: banks
// change slowly, so it repaints only when the snow actually changed.
//
// Detecting "changed" is the subtle part. `simulation` is a plain JavaScript
// object, so QML bindings on `simulation.bankRevision` are never re-evaluated
// and the canvas used to paint exactly once, before any snow had landed. The
// revision is therefore polled by sync(), which MonitorScene calls every frame.
//
// Three further guarantees keep the snow from going stale or dark:
//  - repaints are rate limited, so a steady snowfall cannot repaint every frame;
//  - the canvas repaints when it becomes available/visible again, because a
//    texture lost to a scene-graph reset comes back empty;
//  - a slow heartbeat repaint heals any texture loss that raised no signal.
Canvas {
  id: renderer

  required property var simulation

  // Canvas.Image is the only target supported by every Qt Quick backend. Qt 6
  // ignores Canvas.FramebufferObject, and on a transparent Wayland layer the
  // latter can leave a black, opaque rectangle when the scene graph resets.
  antialiasing: false

  readonly property real minIntervalMs: 66      // at most ~15 repaints/s
  readonly property real heartbeatMs: 1500

  property int paintedRevision: -1
  property real lastPaintStamp: 0
  property bool dirty: true

  // Called every frame by MonitorScene.
  function sync() {
    var sim = renderer.simulation
    if (!sim) return
    var stamp = Simulation.now()
    var changed = sim.bankRevision !== renderer.paintedRevision || renderer.dirty
    var due = stamp - renderer.lastPaintStamp
    if ((changed && due >= renderer.minIntervalMs) || due >= renderer.heartbeatMs)
      renderer.requestPaint()
  }

  function invalidate() {
    renderer.dirty = true
    renderer.requestPaint()
  }

  onAvailableChanged: if (available) renderer.invalidate()
  onVisibleChanged: if (visible) renderer.invalidate()
  onWidthChanged: renderer.dirty = true
  onHeightChanged: renderer.dirty = true
  Component.onCompleted: renderer.invalidate()

  onPaint: {
    var ctx = getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    var sim = renderer.simulation
    renderer.lastPaintStamp = Simulation.now()
    renderer.dirty = false
    if (!sim) return
    renderer.paintedRevision = sim.bankRevision
    if (!sim.surfaces || sim.surfaces.length === 0) return

    // Solid, fully specified paint state on every pass: nothing is inherited
    // from a previous paint or from a context that was recreated meanwhile.
    ctx.globalAlpha = 1
    for (var s = 0; s < sim.surfaces.length; s++) {
      var surface = sim.surfaces[s]
      var bank = surface.bank
      if (!bank) continue
      drawBank(ctx, surface, bank)
    }
  }

  // Draw only the mounds that stand on a surface. Runs of segments with snow
  // become one smoothed polygon each, so empty stretches cost nothing and
  // nothing is ever filled below the surface line (which used to paint a slab
  // over the panel). The top edge is traced through segment midpoints with
  // quadratic curves: a window cap then reads as a row of soft pillows instead
  // of the old flat rectangular bar.
  function drawBank(ctx, surface, bank) {
    // The reference keeps a thin, continuous white lip along the very bottom
    // of the screen even where the height map is almost empty. Draw that base
    // first for the ground surface only; window caps stay exactly where the
    // snow is. It is visual-only — no height map values are changed.
    if (String(surface.id || "").indexOf("ground:") === 0
        || surface.y >= renderer.height - 2) {
      var baseTop = Math.min(surface.y, renderer.height - 3.5)
      ctx.beginPath()
      ctx.moveTo(surface.x, surface.y)
      ctx.lineTo(surface.x, baseTop)
      for (var bx = surface.x + bank.segmentWidth; bx < surface.x + surface.width; bx += bank.segmentWidth * 4) {
        var bump = Math.sin(bx * 0.037) * 0.9
        ctx.lineTo(bx, baseTop - bump)
      }
      ctx.lineTo(surface.x + surface.width, baseTop)
      ctx.lineTo(surface.x + surface.width, surface.y)
      ctx.closePath()
      ctx.fillStyle = "#f4f9ff"
      ctx.fill()
      ctx.globalAlpha = 0.28
      ctx.strokeStyle = "#8fa8c2"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(surface.x, surface.y - 0.5)
      ctx.lineTo(surface.x + surface.width, surface.y - 0.5)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    var i = 0
    var n = bank.segments
    var w = bank.segmentWidth
    while (i < n) {
      while (i < n && bank.heights[i] < 0.25) i++
      if (i >= n) break
      var start = i
      var maxHeight = 0
      while (i < n && bank.heights[i] >= 0.25) {
        if (bank.heights[i] > maxHeight) maxHeight = bank.heights[i]
        i++
      }
      var end = i                      // exclusive

      var top = Math.max(1, maxHeight)
      var gradient = ctx.createLinearGradient(0, surface.y - top, 0, surface.y)
      gradient.addColorStop(0, "#ffffff")
      gradient.addColorStop(0.55, "#f4f9ff")
      gradient.addColorStop(1, "#dbe7f3")

      ctx.beginPath()
      ctx.moveTo(surface.x + start * w, surface.y)
      traceTop(ctx, surface, bank, start, end)
      ctx.lineTo(surface.x + end * w, surface.y)
      ctx.closePath()
      ctx.fillStyle = gradient
      ctx.fill()

      // A cool contact line where the snow meets the glass or screen edge,
      // plus a bright lip along the crest — the two cues that make the drifts
      // in the reference look soft rather than like white cardboard.
      ctx.globalAlpha = 0.28
      ctx.strokeStyle = "#8fa8c2"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(surface.x + start * w, surface.y - 0.5)
      ctx.lineTo(surface.x + end * w, surface.y - 0.5)
      ctx.stroke()
      ctx.globalAlpha = 1

      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"
      ctx.lineWidth = 1.2
      ctx.beginPath()
      traceTop(ctx, surface, bank, start, end)
      ctx.stroke()
    }
  }

  // Trace the crest of one run through midpoint-smoothed quadratic curves.
  // Single-segment drifts are just a line, so very shallow snow stays cheap.
  function crestY(surface, bank, index) {
    // Visual-only softness: the height map stays physically exact, but a small
    // stable ripple (seeded by the segment index and surface position) breaks
    // up a long, uniformly deep drift into the overlapping pillows seen in the
    // reference. It is a pure function, so repaints never make it shimmer.
    var ripple = (Math.sin(index * 0.31 + surface.x * 0.017)
      + Math.sin(index * 0.11 + surface.y * 0.009) + 2.2) * 0.6
    return surface.y - Math.max(0.8, bank.heights[index] + ripple)
  }

  function traceTop(ctx, surface, bank, start, end) {
    var w = bank.segmentWidth
    var count = end - start
    if (count === 1) {
      ctx.lineTo(surface.x + start * w + w * 0.5, crestY(surface, bank, start))
      return
    }
    var px = surface.x + start * w + w * 0.5
    var py = crestY(surface, bank, start)
    ctx.lineTo(px, py)
    for (var k = start + 1; k < end - 1; k++) {
      var nx = surface.x + k * w + w * 0.5
      var ny = crestY(surface, bank, k)
      ctx.quadraticCurveTo(nx, ny, (px + nx) * 0.5, (py + ny) * 0.5)
      px = nx
      py = ny
    }
    var lx = surface.x + (end - 1) * w + w * 0.5
    var ly = crestY(surface, bank, end - 1)
    ctx.quadraticCurveTo(px, py, lx, ly)
  }
}
