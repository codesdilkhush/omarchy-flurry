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

  readonly property bool active: scene.simulation !== null && scene.visible
  property real _lastTick: 0

  // One frame notification for sibling tools (the snowman builder mirrors the
  // rolling ball's plain-JS state here). No extra timer is introduced.
  signal frame()

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
  }

  // The plow is another pure-JS subsystem; this canvas only reads its state.
  // It repaints on the same notification, with no independent timer.
  SnowPlowRenderer {
    id: plowLayer
    anchors.fill: parent
    simulation: scene.simulation
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
      tick.interval = sim.quality === "high" ? 16 : 33
      var stamp = Simulation.now()
      var elapsed = scene._lastTick > 0 ? (stamp - scene._lastTick) / 1000 : 1 / 60
      scene._lastTick = stamp
      // `paused` is read here, per tick, for the same reason. A paused
      // simulation costs one timer wake-up and no painting.
      if (sim.paused) return
      Simulation.update(sim, elapsed)
      flakes.requestPaint()
      tracks.requestPaint()
      plowLayer.requestPaint()
      banks.sync()
      // Notify after the physics step so tools mirror the *current* roll
      // position, not last frame's.
      scene.frame()
    }
  }

  onSimulationChanged: {
    scene._lastTick = 0
    banks.invalidate()
    flakes.requestPaint()
    tracks.requestPaint()
    plowLayer.requestPaint()
  }
}
