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

  // Freeze just the test monitor's physics (not the service's builder mode) so
  // a test can tell snow picked up by the roller from snow falling meanwhile.
  function setSimPaused(paused) {
    var sim = svc.simulations["T-1"]
    if (sim) sim.paused = !!paused
  }

  onReportTickChanged: {
    var sim = svc.simulations["T-1"]
    var surf = []
    for (var i = 0; i < sim.surfaces.length; i++) {
      var s = sim.surfaces[i]; var mx = 0
      for (var k = 0; k < s.bank.segments; k++) mx = Math.max(mx, s.bank.heights[k])
      surf.push({ id: s.id, y: s.y, x: s.x, w: s.width, maxHeight: mx })
    }
    reportText = JSON.stringify({ total: snowTotal(), surfaces: surf, snowmen: svc.snowmen, builder: svc.builderActive })
  }
}
