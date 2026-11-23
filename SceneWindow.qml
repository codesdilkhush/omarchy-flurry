import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import "lib/sim.js" as Sim
import "lib/draw.js" as Draw
import "lib/store.js" as Store

// One screen's weather. A transparent layer over the windows that takes no
// input except on the things you can touch: decorations, visitors, and, in
// decorate mode, the whole screen.
PanelWindow {
  id: sceneWin

  property var service: null

  readonly property var monitor: Hyprland.monitorFor(screen)
  readonly property var workspace: monitor ? monitor.activeWorkspace : null
  readonly property string screenName: screen ? String(screen.name) : ""
  readonly property bool decorating: !!service && service.decorating === screenName
  readonly property bool effectOn: !!service && service.isOn
  readonly property bool fullscreenApp: !!workspace && workspace.hasFullscreen && fullscreenMode() >= 2
  readonly property bool live: effectOn && !fullscreenApp
  readonly property bool busy: santa.running || yeti.mode !== "" || train.mode !== ""

  // The ground sits above anything reserving the bottom of the screen.
  readonly property real groundInset: {
    var r = monitor && monitor.lastIpcObject && monitor.lastIpcObject.reserved ? monitor.lastIpcObject.reserved : [0, 0, 0, 0]
    return Number(r[3]) || 0
  }
  readonly property real groundY: height - groundInset

  color: "transparent"
  visible: !!service && (live || decorating || busy)
  exclusionMode: ExclusionMode.Ignore
  anchors { top: true; bottom: true; left: true; right: true }
  WlrLayershell.namespace: "flurry"
  WlrLayershell.layer: WlrLayer.Top
  WlrLayershell.keyboardFocus: decorating ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  function fullscreenMode() {
    var mode = 0
    var list = workspace && workspace.toplevels ? workspace.toplevels.values : []
    for (var i = 0; i < list.length; i++) {
      var ipc = list[i].lastIpcObject
      if (ipc && ipc.fullscreen) mode = Math.max(mode, Number(ipc.fullscreen))
    }
    return mode
  }

  // ------------------------------------------------------------ simulation

  property var world: null
  property real clock: 0
  property real frameDebt: 0
  property string surfaceSig: ""
  // Window rectangles on this screen, screen-local, for placing decorations.
  property var windowRects: []
  // Bumped a few times a second so decorations follow the snow under them.
  property int heapTick: 0

  Component.onCompleted: {
    world = Sim.createWorld(width, height, { effect: service ? service.effect : "snow", intensity: service ? service.intensity : 1, groundInset: groundInset })
    if (service) service.registerScene(screenName, sceneWin)
  }
  Component.onDestruction: if (service) service.unregisterScene(screenName, sceneWin)

  onWidthChanged: if (world) Sim.resize(world, width, height, groundInset)
  onHeightChanged: if (world) Sim.resize(world, width, height, groundInset)
  onGroundInsetChanged: if (world) Sim.resize(world, width, height, groundInset)

  Connections {
    target: sceneWin.service
    function onEffectChanged() { if (sceneWin.world) Sim.setEffect(sceneWin.world, sceneWin.service.effect) }
    function onIntensityChanged() { if (sceneWin.world) Sim.setIntensity(sceneWin.world, sceneWin.service.intensity) }
  }

  onLiveChanged: {
    if (live || !world) return
    // Off: nothing keeps falling in the background, and the canvas is cleared.
    world.particles = []
    canvas.requestPaint()
  }

  function readWindows() {
    var list = workspace && workspace.toplevels ? workspace.toplevels.values : []
    var sx = screen ? screen.x : 0, sy = screen ? screen.y : 0
    var rects = []
    for (var i = 0; i < list.length; i++) {
      var ipc = list[i].lastIpcObject
      if (!ipc || !ipc.at || !ipc.size || ipc.hidden || ipc.mapped === false) continue
      rects.push({
        id: String(ipc.address || list[i].address),
        cls: String(ipc["class"] || ""),
        x: ipc.at[0] - sx, y: ipc.at[1] - sy, w: ipc.size[0], h: ipc.size[1],
        floating: !!ipc.floating,
        z: ipc.focusHistoryID === undefined ? 50 : Number(ipc.focusHistoryID)
      })
    }
    return rects
  }

  function syncWindows() {
    var rects = readWindows()
    var sig = rects.map(function(r) { return [r.id, r.x, r.y, r.w, r.h, r.floating ? 1 : 0, r.z].join(",") }).join(";")
    if (sig === surfaceSig) return
    if (surfaceSig !== "") service.noteMotion()
    surfaceSig = sig
    windowRects = rects
    Sim.setSurfaces(world, rects, clock)
  }

  FrameAnimation {
    id: frames
    running: sceneWin.visible && (sceneWin.live || sceneWin.busy || sceneWin.decorating)
    onTriggered: {
      var dt = frameTime
      sceneWin.clock += dt
      // On battery the scene draws every other frame.
      if (sceneWin.service.quality < 1) {
        sceneWin.frameDebt += dt
        if (sceneWin.frameDebt < 1 / 30) return
        dt = sceneWin.frameDebt
        sceneWin.frameDebt = 0
      }
      sceneWin.syncWindows()
      if (sceneWin.live) {
        sceneWin.world.quality = sceneWin.service.quality
        var p = sceneWin.service.pointer
        var local = p.present ? { x: p.x - sceneWin.screen.x, y: p.y - sceneWin.screen.y, vx: p.vx, vy: p.vy,
                                  present: p.x >= sceneWin.screen.x && p.x < sceneWin.screen.x + sceneWin.width
                                        && p.y >= sceneWin.screen.y && p.y < sceneWin.screen.y + sceneWin.height,
                                  stillFor: p.stillFor } : null
        Sim.step(sceneWin.world, dt, { pointer: local })
        canvas.requestPaint()
      }
      sceneWin.stepVisitors(dt)
    }
  }

  Timer {
    interval: 400
    repeat: true
    running: frames.running
    onTriggered: sceneWin.heapTick++
  }

  Canvas {
    id: canvas
    anchors.fill: parent
    visible: sceneWin.live
    renderTarget: Canvas.FramebufferObject
    renderStrategy: Canvas.Cooperative
    onPaint: if (sceneWin.world) Draw.world(getContext("2d"), sceneWin.world)
  }

  // ------------------------------------------------------------ placement

  function rectForClass(cls) {
    for (var i = 0; i < windowRects.length; i++) if (windowRects[i].cls === cls) return windowRects[i]
    return null
  }

  // Whether a window of this class still exists anywhere, on any workspace.
  function classAlive(cls) {
    var all = Hyprland.toplevels.values
    for (var i = 0; i < all.length; i++) {
      var ipc = all[i].lastIpcObject
      if (ipc && String(ipc["class"] || "") === cls) return true
    }
    return false
  }

  function groundTop(x) {
    var tick = heapTick
    var y = world ? Sim.restingY(world, Sim.GROUND_ID, x) : null
    return y === null ? groundY : y
  }

  // Feet position for a saved place, or null when it rides a window that is
  // not on this screen's workspace right now.
  function feetFor(place) {
    var tick = heapTick
    if (place.windowClass) {
      var r = rectForClass(place.windowClass)
      if (!r) return null
      var x = r.x + place.windowFx * r.w
      var top = world ? Sim.restingY(world, r.id, x) : r.y
      return { x: x, y: top === null ? r.y : top }
    }
    var fx = place.fx * width
    return { x: fx, y: place.fy >= 0.999 ? groundTop(fx) : place.fy * groundY }
  }

  // Where something dropped at feet (x, y) belongs. A snowman let go just
  // above a window's top edge rides that window.
  function placeAt(kind, x, y) {
    if (kind === "snowman") {
      for (var i = 0; i < windowRects.length; i++) {
        var r = windowRects[i]
        if (x >= r.x && x <= r.x + r.w && y >= r.y - 40 && y <= r.y + 30 && r.cls)
          return { screen: screenName, fx: x / width, fy: 1, windowClass: r.cls, windowFx: (x - r.x) / r.w }
      }
    }
    var fy = Math.max(0.05, Math.min(1, y / groundY))
    if (fy > 0.95) fy = 1
    return { screen: screenName, fx: Math.max(0, Math.min(1, x / width)), fy: fy, windowClass: "", windowFx: 0.5 }
  }

  // A snowman whose window is gone for good drops to the ground below it.
  Timer {
    interval: 3000
    repeat: true
    running: sceneWin.effectOn && Hyprland.toplevels.values.length > 0
    onTriggered: {
      var list = sceneWin.service.saved.snowmen
      for (var i = 0; i < list.length; i++) {
        var m = list[i]
        if (m.place.screen !== sceneWin.screenName || !m.place.windowClass) continue
        if (!sceneWin.classAlive(m.place.windowClass))
          sceneWin.service.moveItem("snowman", m.id, { screen: sceneWin.screenName, fx: m.place.fx, fy: 1, windowClass: "", windowFx: 0.5 })
      }
    }
  }

  // ------------------------------------------------------------ decorations

  readonly property var decorations: {
    if (!service) return []
    var s = service.saved
    var out = []
    var add = function(kind, list) {
      for (var i = 0; i < list.length; i++) if (list[i].place.screen === sceneWin.screenName || (!list[i].place.screen && sceneWin.isPrimary()))
        out.push({ kind: kind, item: list[i] })
    }
    add("tree", s.trees)
    add("gift", s.gifts)
    add("snowman", s.snowmen)
    return out
  }

  // Delegates are keyed by id, so a state change elsewhere (a friend added,
  // the inbox position saved) never rebuilds a decoration mid-drag.
  readonly property var decorationsByKey: {
    var map = {}
    for (var i = 0; i < decorations.length; i++) map[decorations[i].kind + ":" + decorations[i].item.id] = decorations[i]
    return map
  }
  ListModel { id: decorModel }
  onDecorationsChanged: {
    var keys = decorations.map(function(d) { return d.kind + ":" + d.item.id })
    for (var i = decorModel.count - 1; i >= 0; i--)
      if (keys.indexOf(decorModel.get(i).key) < 0) decorModel.remove(i)
    var have = {}
    for (var j = 0; j < decorModel.count; j++) have[decorModel.get(j).key] = true
    for (var k = 0; k < keys.length; k++) if (!have[keys[k]]) decorModel.append({ key: keys[k] })
  }

  function isPrimary() { return Quickshell.screens.length > 0 && Quickshell.screens[0] === screen }

  // Mask slots: decorations register the item that takes their input.
  property var touchables: []
  function addTouchable(item) { touchables = touchables.concat([item]) }
  function removeTouchable(item) { touchables = touchables.filter(function(x) { return x !== item }) }
  function touchable(i) { return i < touchables.length && touchables[i].visible ? touchables[i] : null }

  property string tool: ""          // decorate-mode tool
  property var seenIds: ({})        // decorations already shown this session
  property var menuFor: null        // { kind, id, x, y }
  property var bubble: null         // { text, x, y }

  // Clicking empty space in decorate mode uses the tool there.
  MouseArea {
    anchors.fill: parent
    enabled: sceneWin.decorating
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onClicked: function(mouse) {
      sceneWin.menuFor = null
      if (mouse.button === Qt.RightButton) { sceneWin.tool = ""; return }
      if (sceneWin.tool === "tree") sceneWin.service.addTree(sceneWin.placeAt("tree", mouse.x, mouse.y))
      else if (sceneWin.tool === "snowman") sceneWin.service.addSnowman(sceneWin.placeAt("snowman", mouse.x, mouse.y))
    }
  }

  Item {
    id: decorLayer
    anchors.fill: parent
    visible: sceneWin.effectOn || sceneWin.decorating

    Repeater {
      model: decorModel
      delegate: Decoration {
        required property string key
        readonly property var entry: sceneWin.decorationsByKey[key] || null
        scene: sceneWin
        kind: key.split(":")[0]
        item: entry ? entry.item : null
      }
    }
  }

  // ------------------------------------------------------------ visitors

  function callSanta() {
    if (!santa.running) santa.start()
    return true
  }

  function callYeti(targetId) {
    if (yeti.mode === "") yeti.begin(targetId)
    return true
  }

  // The train runs one job at a time.
  property var trainJobs: []
  function trainPickup(kind, id, done) { queueTrain({ type: "pickup", kind: kind, id: id, done: done }) }
  function trainDeliver(gift) { queueTrain({ type: "deliver", gift: gift }) }
  function trainDepart(cargo) { queueTrain({ type: "depart", cargo: cargo }) }
  function queueTrain(job) {
    trainJobs = trainJobs.concat([job])
    if (train.mode === "") train.next()
  }

  function stepVisitors(dt) {
    if (santa.running) santa.step(dt)
    if (yeti.mode !== "") yeti.step(dt)
    if (train.mode !== "") train.step(dt)
  }

  function stats() { return world ? Sim.stats(world) : null }

  Visitor {
    id: santa
    scene: sceneWin
    width: 260; height: 96
    painter: function(ctx, w, h, t) { Draw.sleigh(ctx, w, h, t) }
    property bool running: false
    property bool dropped: false
    function start() {
      x = -width; y = sceneWin.height * 0.1; dropped = false; running = true; visible = true
    }
    function step(dt) {
      x += dt * sceneWin.width / 14
      y = sceneWin.height * 0.1 + Math.sin(sceneWin.clock * 1.3) * 18
      paint()
      if (x > sceneWin.width + 20) { running = false; visible = false }
    }
    onTapped: {
      sceneWin.say("Ho ho ho!", x + width * 0.25, y)
      if (dropped) return
      dropped = true
      var gx = Math.max(20, Math.min(sceneWin.width - 20, x + width * 0.2))
      sceneWin.service.addGift(sceneWin.placeAt("gift", gx, sceneWin.groundY), { from: "Santa", note: "Merry Christmas!" })
    }
  }

  Visitor {
    id: yeti
    scene: sceneWin
    width: 120; height: 150
    property string mode: ""        // "", "walk", "grab", "leave", "flee"
    property string targetId: ""
    property real targetX: 0
    property real facing: 1
    property bool carrying: false
    property real wait: 0
    painter: function(ctx, w, h, t) { Draw.yeti(ctx, w, h, t, yeti.facing, yeti.carrying, yeti.mode === "flee") }

    function begin(id) {
      targetId = id
      var target = id ? sceneWin.service.find("snowman", id) : null
      var feet = target ? sceneWin.feetFor(target.place) : null
      facing = Math.random() < 0.5 ? 1 : -1
      x = facing > 0 ? -width : sceneWin.width
      targetX = feet ? feet.x - width / 2 : (facing > 0 ? sceneWin.width + width : -width * 2)
      if (feet) facing = targetX > x ? 1 : -1
      carrying = false
      mode = "walk"
      visible = true
    }
    function step(dt) {
      y = sceneWin.groundTop(x + width / 2) - height
      var speed = mode === "flee" ? 520 : 110
      if (mode === "walk") {
        x += facing * speed * dt
        if ((facing > 0 && x >= targetX) || (facing < 0 && x <= targetX)) {
          if (targetId && sceneWin.service.find("snowman", targetId)) { mode = "grab"; wait = 1.1 }
          else mode = "leave"
        }
      } else if (mode === "grab") {
        wait -= dt
        if (wait <= 0) {
          if (sceneWin.service.find("snowman", targetId)) {
            sceneWin.service.removeItem("snowman", targetId)
            carrying = true
            sceneWin.service.notify("The Yeti took your snowman!", "Click him next time to scare him off.")
          }
          facing = x + width / 2 < sceneWin.width / 2 ? -1 : 1
          mode = "leave"
        }
      } else {
        x += facing * speed * dt
      }
      paint()
      if (x < -width * 1.5 || x > sceneWin.width + width * 0.5) { mode = ""; visible = false }
    }
    onTapped: {
      if (mode === "flee" || carrying) return
      sceneWin.say("Eek!", x + width / 2, y)
      facing = x + width / 2 < sceneWin.width / 2 ? -1 : 1
      mode = "flee"
    }
  }

  Visitor {
    id: train
    scene: sceneWin
    width: 200; height: 80
    property string mode: ""        // "", "in", "stop", "out"
    property var job: null
    property real stopX: 0
    property real wait: 0
    property string cargo: ""
    painter: function(ctx, w, h, t) { Draw.train(ctx, w, h, t, 1, train.cargo) }

    function next() {
      if (!sceneWin.trainJobs.length) { mode = ""; visible = false; job = null; return }
      job = sceneWin.trainJobs[0]
      sceneWin.trainJobs = sceneWin.trainJobs.slice(1)
      x = -width
      if (job.type === "pickup") {
        var item = sceneWin.service.find(job.kind, job.id)
        var feet = item ? sceneWin.feetFor(item.place) : null
        stopX = feet ? feet.x - width * 0.21 : sceneWin.width * 0.5
        cargo = ""
      } else if (job.type === "deliver") {
        stopX = sceneWin.width * (0.3 + Math.random() * 0.4)
        cargo = job.gift.kind === "note" ? "note" : (job.gift.kind === "tree" ? "tree" : (job.gift.kind === "snowman" ? "snowman" : "gift"))
      } else {
        stopX = -1
        cargo = job.cargo
      }
      mode = "in"
      visible = true
    }
    function step(dt) {
      y = sceneWin.groundTop(x + width / 2) - height
      if (mode === "in") {
        x += 180 * dt
        if (stopX >= 0 && x >= stopX) { x = stopX; mode = "stop"; wait = 1.2 }
        else if (stopX < 0 && x > sceneWin.width) { next(); return }
      } else if (mode === "stop") {
        wait -= dt
        if (wait <= 0) {
          if (job.type === "pickup") {
            cargo = job.kind
            if (job.done) job.done()
          } else if (job.type === "deliver") {
            sceneWin.service.deliverAt(job.gift, sceneWin.placeAt(job.gift.kind, x + width * 0.21, sceneWin.groundY))
            cargo = ""
          }
          mode = "out"
        }
      } else if (mode === "out") {
        x += 200 * dt
        if (x > sceneWin.width) { next(); return }
      }
      paint()
    }
  }

  function say(text, x, y) {
    bubble = { text: String(text), x: x, y: y }
    bubbleTimer.restart()
  }
  Timer { id: bubbleTimer; interval: 2600; onTriggered: sceneWin.bubble = null }

  Rectangle {
    id: bubbleView
    visible: sceneWin.bubble !== null
    x: sceneWin.bubble ? Math.max(8, Math.min(sceneWin.width - width - 8, sceneWin.bubble.x - width / 2)) : 0
    y: sceneWin.bubble ? Math.max(8, sceneWin.bubble.y - height - 10) : 0
    width: Math.min(320, bubbleText.implicitWidth + 24)
    height: bubbleText.implicitHeight + 16
    radius: 10
    color: "#fbf7ee"
    border.color: "#d8ccb0"
    Text {
      id: bubbleText
      anchors.centerIn: parent
      width: Math.min(296, implicitWidth)
      wrapMode: Text.Wrap
      text: sceneWin.bubble ? sceneWin.bubble.text : ""
      color: "#3a2f22"
      font.pixelSize: 14
      font.family: Style.font.family
    }
  }

  // ------------------------------------------------------------ menus

  function openMenu(kind, id, x, y) { menuFor = { kind: kind, id: id, x: x, y: y } }

  ContextMenu {
    id: menu
    scene: sceneWin
  }

  Toolbar {
    id: toolbar
    scene: sceneWin
    visible: sceneWin.decorating
  }

  Item {
    focus: sceneWin.decorating
    Keys.onEscapePressed: {
      if (sceneWin.menuFor) sceneWin.menuFor = null
      else if (sceneWin.tool) sceneWin.tool = ""
      else sceneWin.service.stopDecorating()
    }
  }

  // ------------------------------------------------------------ input mask

  mask: Region {
    Region { item: sceneWin.decorating ? decorLayer : null }
    Region { item: santa.visible ? santa : null }
    Region { item: yeti.visible ? yeti : null }
    Region { item: menu.visible ? menu : null }
    Region { item: toolbar.visible ? toolbar : null }
    // One slot per decoration (3 trees, 12 snowmen, 24 gifts at most).
    Region { item: sceneWin.touchable(0) }
    Region { item: sceneWin.touchable(1) }
    Region { item: sceneWin.touchable(2) }
    Region { item: sceneWin.touchable(3) }
    Region { item: sceneWin.touchable(4) }
    Region { item: sceneWin.touchable(5) }
    Region { item: sceneWin.touchable(6) }
    Region { item: sceneWin.touchable(7) }
    Region { item: sceneWin.touchable(8) }
    Region { item: sceneWin.touchable(9) }
    Region { item: sceneWin.touchable(10) }
    Region { item: sceneWin.touchable(11) }
    Region { item: sceneWin.touchable(12) }
    Region { item: sceneWin.touchable(13) }
    Region { item: sceneWin.touchable(14) }
    Region { item: sceneWin.touchable(15) }
    Region { item: sceneWin.touchable(16) }
    Region { item: sceneWin.touchable(17) }
    Region { item: sceneWin.touchable(18) }
    Region { item: sceneWin.touchable(19) }
    Region { item: sceneWin.touchable(20) }
    Region { item: sceneWin.touchable(21) }
    Region { item: sceneWin.touchable(22) }
    Region { item: sceneWin.touchable(23) }
    Region { item: sceneWin.touchable(24) }
    Region { item: sceneWin.touchable(25) }
    Region { item: sceneWin.touchable(26) }
    Region { item: sceneWin.touchable(27) }
    Region { item: sceneWin.touchable(28) }
    Region { item: sceneWin.touchable(29) }
    Region { item: sceneWin.touchable(30) }
    Region { item: sceneWin.touchable(31) }
    Region { item: sceneWin.touchable(32) }
    Region { item: sceneWin.touchable(33) }
    Region { item: sceneWin.touchable(34) }
    Region { item: sceneWin.touchable(35) }
    Region { item: sceneWin.touchable(36) }
    Region { item: sceneWin.touchable(37) }
    Region { item: sceneWin.touchable(38) }
    Region { item: sceneWin.touchable(39) }
  }
}
