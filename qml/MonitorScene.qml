import QtQuick
import "../js/Simulation.js" as Simulation

// Per-monitor scene host and the single frame loop for that monitor.
//
// The simulation is a plain JavaScript object. QML cannot observe changes to
// the properties of such an object, so a binding like `simulation.bankRevision`
// is evaluated once and never again. Everything that has to react to the
// simulation therefore reacts to *this* loop: each tick advances the physics,
// repaints the flakes, and asks the bank layer to check whether the snow
// actually changed.
Item {
  id: scene

  required property var simulation

  // Whether the host surface is actually mapped. An Item's own `visible` stays
  // true when its window is hidden, so the overlay passes the window state in
  // here; without it the physics and four full-screen canvases kept running
  // at 30 Hz while snowfall was switched off or paused.
  property bool running: true

  readonly property bool active: scene.simulation !== null && scene.running && scene.visible

  // Mirrors `simulation.paused` (fullscreen pause), polled each tick for the
  // same reason as everything else here. Hides the flakes so a frozen frame of
  // snow is never left hanging in the air.
  property bool simPaused: false

  property real _lastTick: 0

  // Paint counters, exposed so tests (and diagnostics) can prove that idle
  // layers really stay idle.
  readonly property int flakePaints: flakes.paintCount
  readonly property int trackPaints: tracks.paintCount
  readonly property int plowPaints: plowLayer.paintCount

  // One frame notification for sibling tools (the snowman builder mirrors the
  // rolling ball's plain-JS state here). No extra timer is introduced.
  signal frame()

  function repaintAll() {
    banks.invalidate()
    flakes.requestPaint()
    tracks.requestPaint()
    plowLayer.requestPaint()
  }

  SnowBankRenderer {
    id: banks
    anchors.fill: parent
    simulation: scene.simulation
  }

  // Impressions are pressed into the snow: they sit on top of the bank layer
  // but under the falling flakes and the vehicle, and repaint on this same loop.
  SnowTrackRenderer {
    id: tracks
    anchors.fill: parent
    simulation: scene.simulation
  }

  SnowRenderer {
    id: flakes
    anchors.fill: parent
    simulation: scene.simulation
    visible: !scene.simPaused
  }

  // The plow is another pure-JS subsystem; this canvas only reads its state.
  // It repaints on the same notification, with no independent timer.
  SnowPlowRenderer {
    id: plowLayer
    anchors.fill: parent
    simulation: scene.simulation
    visible: !scene.simPaused
  }

  Timer {
    id: tick
    // Physics keeps the fixed 60 Hz step inside Simulation.update(); only the
    // compositing rate is throttled. Re-evaluated every tick because quality
    // is a field of a plain JS object and cannot drive a binding.
    interval: 33
    repeat: true
    running: scene.active
    onTriggered: {
      var sim = scene.simulation
      if (!sim) return
      tick.interval = Simulation.frameIntervalFor(sim.quality)
      var stamp = Simulation.now()
      var elapsed = scene._lastTick > 0 ? (stamp - scene._lastTick) / 1000 : 1 / 60
      scene._lastTick = stamp
      // `paused` is read here, per tick, for the same reason. A paused
      // simulation costs one timer wake-up and no painting.
      scene.simPaused = sim.paused === true
      if (sim.paused) return
      Simulation.update(sim, elapsed)
      flakes.requestPaint()
      // Tracks and the vehicle are idle most of the time: skip their paints
      // (a full-screen texture upload each) unless something is on screen.
      if (tracks.wantsPaint()) tracks.requestPaint()
      if (plowLayer.wantsPaint()) plowLayer.requestPaint()
      banks.sync()
      // Notify after the physics step so tools mirror the *current* roll
      // position, not last frame's.
      scene.frame()
    }
  }

  // Coming back from a hidden or paused state must not replay the gap as one
  // huge physics step, and canvases may have lost their textures meanwhile.
  onActiveChanged: {
    scene._lastTick = 0
    if (scene.active) scene.repaintAll()
  }

  onSimulationChanged: {
    scene._lastTick = 0
    scene.simPaused = false
    scene.repaintAll()
  }
}
