import QtQuick
import "../js/Simulation.js" as Simulation
import "../js/FlakeShape.js" as FlakeShape

// Batched falling-snow renderer.
//
// One Canvas per monitor draws every flake in a single paint pass. There is no
// QML object per particle: the simulation owns fixed typed arrays and this
// component only walks them. Both the steady snowfall and the bounded pool of
// flakes shed by moving windows are drawn here; pressed tracks have their own
// small canvas (SnowTrackRenderer) so nothing is painted twice. MonitorScene
// owns the frame loop and calls requestPaint().
Canvas {
  id: renderer

  required property var simulation

  property real lastPaintMs: 0
  property int paintCount: 0

  // Keep Qt's default Canvas.Image backing store. Qt 6 ignores
  // Canvas.FramebufferObject, and asking for it on a transparent layer surface
  // can leave an opaque/black canvas when the scene graph is re-created. The
  // image target is supported by every backend and is always alpha-correct.
  antialiasing: false

  // A Canvas backing store can be dropped when the scene graph is re-created
  // (layer change, output hotplug, unmap/map). Repaint whenever it comes back.
  onAvailableChanged: if (available) renderer.requestPaint()
  onVisibleChanged: if (visible) renderer.requestPaint()

  onPaint: {
    renderer.paintCount++
    var started = Simulation.now()
    var ctx = getContext("2d")
    if (!ctx) return

    // Fully specified paint state: nothing inherited from a recreated context.
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, width, height)
    var sim = renderer.simulation
    if (!sim) return

    drawPool(ctx, sim.system)
    if (sim.detachedSystem) drawPool(ctx, sim.detachedSystem)
    ctx.globalAlpha = 1

    renderer.lastPaintMs = Simulation.now() - started
    Simulation.recordPaint(renderer.simulation, renderer.lastPaintMs)
  }

  // Kept local to the renderer so both pools share exactly the same visual
  // language: a shed flake looks identical to a falling one.
  function drawPool(ctx, pool) {
    if (!pool || pool.count === 0) return
    for (var i = 0; i < pool.count; i++)
      FlakeShape.draw(ctx, pool.x[i], pool.y[i], pool.r[i],
        pool.rot[i], pool.alpha[i], pool.type[i])
  }
}
