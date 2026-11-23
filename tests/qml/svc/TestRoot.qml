import QtQuick
import "js/Simulation.js" as Sim
import "qml"

Rectangle {
  id: root
  width: 800; height: 500
  color: "#20304a"
  property int enterTick: 0
  property real advanceSeconds: 0
  property int reportTick: 0
  property string reportText: ""

  Service { id: svc }

  MonitorScene { id: sceneLayer; anchors.fill: parent; simulation: svc.simulations["T-1"] }
  SnowmanRenderer { anchors.fill: parent; snowmen: svc.snowmen; revision: svc.snowmenRevision; monitorName: "T-1" }
  SnowmanBuilder { id: builderTool; anchors.fill: parent; visible: svc.builderActive; service: svc; monitorName: "T-1" }
  Connections { target: sceneLayer; function onFrame() { builderTool.syncRoll() } }

  function snowTotal() {
    var sim = svc.simulations["T-1"]; var t = 0
    for (var i = 0; i < sim.surfaces.length; i++) {
      var b = sim.surfaces[i].bank
      for (var k = 0; k < b.segments; k++) t += b.heights[k] * b.segmentWidth
    }
    return t
  }

  onAdvanceSecondsChanged: {
    var sim = svc.simulations["T-1"]
    var n = Math.round(advanceSeconds * 60)
    for (var i = 0; i < n; i++) Sim.step(sim, 1/60)
  }

  property int decorateTick: 0
  onDecorateTickChanged: {
    var id = svc.snowmen[0].id; var n = svc.snowmen[0].balls.length
    svc.addDecoration(id, "carrot", n - 1, 0, 0); svc.addDecoration(id, "eyes", n - 1, 0, 0)
    svc.addDecoration(id, "hat", n - 1, 0, 0); svc.addDecoration(id, "buttons", 1, 0, 0)
    svc.addDecoration(id, "scarf", n - 1, 0, 4); svc.addDecoration(id, "arms", 1, 0, 0)
    svc.addDecoration(id, "mouth", n - 1, 0, 0)
  }
  onEnterTickChanged: svc.enterBuilder()

  // ---- black-screen guard hooks -------------------------------------------
  // Feed a fake `hyprctl getoption` answer through the real probe handler.
  function simulateCompositor(text) {
    svc.compositorState = "checking"
    svc.finishCompositorProbe(text)
    return svc.mode
  }
  function setGuard(on) { svc.rawSettings = { transparencyGuard: on, settingsRevision: 2 } }
  function mode() { return svc.mode }
  function overlayMapped() { return svc.overlayMapped }
  function builderActive() { return svc.builderActive }
  function tryEnterBuilder() { return svc.enterBuilder() }
  function setSceneRunning(on) { sceneLayer.running = on }

  // Freeze just the test monitor's physics (not the service's builder mode) so
  // a test can tell snow picked up by the roller from snow falling meanwhile.
  function setSimPaused(paused) {
    var sim = svc.simulations["T-1"]
    if (sim) sim.paused = !!paused
  }

  // Stop new snow landing and the plough removing it, but keep the fixed physics
  // step running. setSimPaused() is NOT suitable for this: the rolling ball
  // advances inside that same step, so pausing the simulation also freezes the
  // roller and leaves only the instant gather at the moment of the press. A test
  // that wanted to prove "dragging picks up snow" then depended on how much snow
  // happened to lie under the press point, and failed most runs.
  property real savedDeposit: 1.6
  property bool savedPlow: true
  function setSnowFrozen(frozen) {
    var sim = svc.simulations["T-1"]
    if (!sim) return
    if (frozen) {
      savedDeposit = sim.depositAmount
      savedPlow = sim.plowEnabled
      sim.depositAmount = 0
      sim.plowEnabled = false
    } else {
      sim.depositAmount = savedDeposit
      sim.plowEnabled = savedPlow
    }
  }

  onReportTickChanged: {
    var sim = svc.simulations["T-1"]
    var surf = []
    for (var i = 0; i < sim.surfaces.length; i++) {
      var s = sim.surfaces[i]; var mx = 0
      for (var k = 0; k < s.bank.segments; k++) mx = Math.max(mx, s.bank.heights[k])
      surf.push({ id: s.id, y: s.y, x: s.x, w: s.width, maxHeight: mx })
    }
    reportText = JSON.stringify({ total: snowTotal(), surfaces: surf, snowmen: svc.snowmen, builder: svc.builderActive,
      paints: { flakes: sceneLayer.flakePaints, tracks: sceneLayer.trackPaints, plow: sceneLayer.plowPaints } })
  }
}
