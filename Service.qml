import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import Quickshell.Hyprland
import "qml"
import "js/Constants.js" as Constants
import "js/MathUtils.js" as MathUtils
import "js/DisplayMath.js" as DisplayMath
import "js/Settings.js" as Settings
import "js/ParticleSystem.js" as ParticleSystem
import "js/Simulation.js" as SimulationModule
import "js/WindowGeometry.js" as WindowGeometry
import "js/SnowBank.js" as SnowBank
import "js/Collision.js" as Collision
import "js/State.js" as StateModule
import "js/SnowmanModel.js" as SnowmanModel
import "js/SnowRoll.js" as SnowRoll
import "js/SnowTracks.js" as SnowTracks
import "js/SnowPlowModel.js" as SnowPlow
import "js/Compositor.js" as Compositor

// Snowglobe's service: the single owner of mode, overlay surfaces, simulation
// state and diagnostics. There is one bounded, deterministic snowfall
// simulation per monitor; the surfaces are click-through and the simulation is
// pure JavaScript, independent of Qt and Hyprland.
//
// omarchy-shell injects `shell` (a capability-scoped facade, never the host
// shell object) and `manifest`. Preferences arrive from BarWidget.qml, which
// owns the inline shell.json entry.
Item {
  id: snowglobe

  property var shell: null
  property var manifest: null

  // Written by the bar widget only. Absent a bar widget, defaults apply.
  property var rawSettings: ({})

  readonly property var settings: Settings.normalize(rawSettings)
  readonly property string version: manifest && manifest.version
    ? String(manifest.version) : Constants.SERVICE_VERSION

  // A transient pause (fullscreen / sleeping monitor) is not a user mode.
  property bool paused: false

  // Builder mode is an explicit input state, not a variant of `mode`: while it
  // is active the surface captures input, and leaving it restores pass-through.
  property bool builderActive: false
  property var snowmen: []
  property int snowmenRevision: 0

  // ---- Black-screen guard --------------------------------------------------
  // "checking" until hyprctl answers (or the probe times out), then "safe",
  // "unsafe" or "unknown". See js/Compositor.js for why an "unsafe" compositor
  // turns a transparent full-screen overlay into a black sheet.
  property string compositorState: Compositor.CHECKING
  property string compositorReason: ""
  readonly property bool overlayAllowed:
    Compositor.overlayAllowed(compositorState, settings.transparencyGuard)

  // disabled: switched off by the user (no surface at all)
  // starting: waiting for the compositor probe before mapping anything
  // blocked:  the compositor would render the overlay black, so it stays off
  // paused:   transient pause from IPC
  // passive:  mapped, click-through, snowing
  readonly property string mode: {
    if (!settings.enabled || settings.overlay === "disabled") return "disabled"
    if (!overlayAllowed)
      return compositorState === Compositor.CHECKING ? "starting" : "blocked"
    if (paused) return "paused"
    return "passive"
  }

  readonly property bool overlayMapped: mode === "passive"
  readonly property int screenCount: Quickshell.screens.length

  // ---- Snowfall simulation (one per monitor) -----------------------------
  // A plain JS map of simulation objects keyed by monitor name. QML never
  // creates an object per particle; each simulation owns fixed typed arrays.
  property var simulations: ({})

  function makeSimulation(screen) {
    var seed = MathUtils.hashSeed(screen.name)
    var random = MathUtils.createRandom(seed)
    var system = ParticleSystem.create(Constants.MAX_PARTICLES.high, random)
    system.width = screen.width
    system.height = screen.height
    var detached = ParticleSystem.create(Constants.MAX_DETACHED, random)
    detached.width = screen.width
    detached.height = screen.height
    return SimulationModule.create({
      system: system,
      particleSystem: ParticleSystem,
      random: random,
      stepSeconds: Constants.STEP_SECONDS,
      maxStepsPerFrame: Constants.MAX_STEPS_PER_FRAME,
      maxBacklogSeconds: Constants.MAX_BACKLOG_SECONDS,
      capacities: Constants.MAX_PARTICLES,
      density: settings.density,
      wind: settings.wind,
      quality: settings.quality,
      adaptiveScale: snowglobe.adaptiveScale,
      frameIntervalMs: SimulationModule.frameIntervalFor(settings.quality),
      bankModule: SnowBank,
      collisionModule: Collision,
      detachedSystem: detached,
      rollModule: SnowRoll,
      tracksModule: SnowTracks,
      maxTracks: Constants.ROLL_TRACK_CAPACITY,
      plowModule: SnowPlow,
      plowEnabled: settings.plowEnabled !== false,
      plowSpawnDepth: Constants.PLOW_SPAWN_DEPTH,
      plowDespawnDepth: Constants.PLOW_DESPAWN_DEPTH,
      plowCooldownSeconds: Constants.PLOW_COOLDOWN_SECONDS,
      plowCapacity: Constants.PLOW_CAPACITY,
      plowSpeed: Constants.PLOW_SPEED,
      plowLoadedSpeedFactor: Constants.PLOW_LOADED_SPEED_FACTOR,
      plowScoopRadius: Constants.PLOW_SCOOP_RADIUS,
      plowScoopAmount: Constants.PLOW_SCOOP_AMOUNT,
      plowUnloadSeconds: Constants.PLOW_UNLOAD_SECONDS,
      plowDustEvery: Constants.PLOW_DUST_EVERY,
      plowSnowmanMargin: Constants.PLOW_SNOWMAN_MARGIN,
      plowTrackRadius: Constants.PLOW_TRACK_RADIUS,
      plowTrackStrength: Constants.PLOW_TRACK_STRENGTH,
      avalancheMinDepth: Constants.AVALANCHE_MIN_DEPTH,
      avalancheChance: Constants.AVALANCHE_CHANCE_PER_SECOND,
      avalancheCooldown: Constants.AVALANCHE_COOLDOWN_SECONDS,
      avalancheSlideAmount: Constants.AVALANCHE_SLIDE_AMOUNT,
      avalancheShedMass: Constants.AVALANCHE_SHED_MASS,
      avalancheCheckSeconds: Constants.AVALANCHE_CHECK_SECONDS,
      settleRollSteps: Constants.SETTLE_ROLL_STEPS,
      settleRollGain: Constants.SETTLE_ROLL_GAIN,
      settleCompactAmount: Constants.SETTLE_COMPACT_AMOUNT,
      settleSinkFraction: Constants.SETTLE_SINK_FRACTION,
      slideSpeed: Constants.WINDOW_SLIDE_SPEED,
      detachSpeed: Constants.WINDOW_DETACH_SPEED,
      windowSlideAmount: Constants.WINDOW_SLIDE_AMOUNT,
      detachMass: Constants.WINDOW_DETACH_MASS,
      detachMaxPerEvent: Constants.WINDOW_DETACH_MAX_PER_EVENT,
      velocityInherit: Constants.WINDOW_VELOCITY_INHERIT,
      detachedGravity: Constants.DETACHED_GRAVITY,
      detachedLift: Constants.DETACHED_LIFT,
      mediumDepth: Constants.WINDOW_MEDIUM_DEPTH,
      heavyDepth: Constants.WINDOW_HEAVY_DEPTH,
      mediumMass: Constants.WINDOW_MEDIUM_MASS,
      heavyMass: Constants.WINDOW_HEAVY_MASS,
      chunkChance: Constants.WINDOW_CHUNK_CHANCE,
      shedKick: Constants.WINDOW_SHED_KICK,
      accumulateOnWindows: settings.accumulateOnWindows,
      maxSurfaces: Constants.MAX_SURFACES,
      depositAmount: Constants.DEPOSIT_AMOUNT,
      depositSpread: Constants.DEPOSIT_SPREAD,
      settleSteps: Constants.BANK_SETTLE_STEPS,
      slideAmount: Constants.BANK_SLIDE_AMOUNT,
      redistributeAmount: Constants.BANK_REDISTRIBUTE_AMOUNT,
      erodeAmount: Constants.BANK_ERODE_AMOUNT,
      segmentWidth: Constants.SEGMENT_WIDTH,
      windowMaxDepth: Constants.WINDOW_MAX_DEPTH,
      groundMaxDepth: Constants.GROUND_MAX_DEPTH
    })
  }

  function rebuildSimulations() {
    var next = ({})
    for (var i = 0; i < Quickshell.screens.length; i++) {
      var screen = Quickshell.screens[i]
      var existing = simulations[screen.name]
      if (existing) {
        SimulationModule.resize(existing, screen.width, screen.height)
        next[screen.name] = existing
      } else {
        next[screen.name] = makeSimulation(screen)
      }
    }
    simulations = next
    applySimulationSettings()
  }

  // ---- Adaptive quality --------------------------------------------------
  property real adaptiveScale: 1
  property int adaptiveLowWindows: 0
  property int adaptiveHighWindows: 0

  function runAdaptiveQuality() {
    if (!settings.adaptiveQuality || !overlayMapped) return
    var worst = 0
    for (var name in simulations) {
      var m = SimulationModule.metrics(simulations[name])
      worst = Math.max(worst, m.avgStepMs + m.avgPaintMs + m.frameDriftMs)
    }
    if (worst <= 0) return
    if (worst > Constants.ADAPTIVE_BUDGET_MS) {
      adaptiveHighWindows++
      adaptiveLowWindows = 0
    } else if (worst < Constants.ADAPTIVE_RECOVER_MS) {
      adaptiveLowWindows++
      adaptiveHighWindows = 0
    } else {
      adaptiveHighWindows = 0
      adaptiveLowWindows = 0
    }
    var next = adaptiveScale
    if (adaptiveHighWindows >= 2) {
      next = Math.max(Constants.ADAPTIVE_MIN_SCALE,
        adaptiveScale - Constants.ADAPTIVE_STEP)
      adaptiveHighWindows = 0
    } else if (adaptiveLowWindows >= 4) {
      next = Math.min(Constants.ADAPTIVE_MAX_SCALE,
        adaptiveScale + Constants.ADAPTIVE_STEP)
      adaptiveLowWindows = 0
    }
    if (next !== adaptiveScale) {
      adaptiveScale = next
      for (var key in simulations)
        SimulationModule.setAdaptiveScale(simulations[key], adaptiveScale)
    }
  }

  Timer {
    id: adaptiveTimer
    interval: Constants.ADAPTIVE_CHECK_MS
    repeat: true
    running: snowglobe.overlayMapped && snowglobe.settings.adaptiveQuality
    onTriggered: snowglobe.runAdaptiveQuality()
  }

  // The plow steers around user-built snowmen, so every simulation needs the
  // plain records. Reassigning the array in markSnowmenChanged makes this cheap
  // to call on every edit; the model filters by monitor when it uses them.
  function syncSnowmenToSimulations() {
    for (var name in simulations)
      SimulationModule.setSnowmen(simulations[name], snowmen)
  }

  function applySimulationSettings() {
    for (var name in simulations) {
      var sim = simulations[name]
      SimulationModule.setDensity(sim, settings.density)
      SimulationModule.setWind(sim, settings.wind)
      SimulationModule.setQuality(sim, settings.quality)
      SimulationModule.setAccumulateOnWindows(sim, settings.accumulateOnWindows)
      SimulationModule.setPlowEnabled(sim, settings.plowEnabled !== false)
    }
    syncSnowmenToSimulations()
    refreshGeometry()
  }

  // ---- Window geometry adapter -------------------------------------------
  // Only this block reads Hyprland. It turns IPC objects into a plain input
  // snapshot; WindowGeometry.js then builds the stable internal model and the
  // simulation sees nothing compositor-specific.
  property var geometryState: WindowGeometry.createState()
  property var geometrySnapshot: null
  property int geometryRevision: 0
  property int bankCount: 0
  property int refreshCount: 0
  property int applyCount: 0
  property int lastInputWindows: 0
  property real geometryTime: 0
  // Updated explicitly: snapshot() returns the same mutated model object, so a
  // binding on its identity would not re-evaluate when windows change.
  property int trackedWindows: 0
  property real fastUntil: 0


  function collectGeometryInput() {
    var monitors = []
    var monitorNames = ({})
    var activeWorkspaces = ({})
    var specialWorkspaces = ({})
    var list = Hyprland.monitors.values
    for (var m = 0; m < list.length; m++) {
      var mon = list[m]
      if (!mon) continue
      var ipc = mon.lastIpcObject || ({})
      var scale = DisplayMath.safeScale(mon.scale)
      var logical = DisplayMath.logicalSize(mon.width, mon.height, scale, ipc.transform)
      var reserved = DisplayMath.reservedArea(ipc.reserved, scale)
      monitors.push({
        name: String(mon.name || ""),
        id: mon.id,
        x: mon.x || 0,
        y: mon.y || 0,
        width: logical.width,
        height: logical.height,
        scale: scale,
        reservedLeft: reserved.left,
        reservedTop: reserved.top,
        reservedRight: reserved.right,
        reservedBottom: reserved.bottom
      })
      monitorNames[mon.id] = String(mon.name || "")
      var activeWs = -1
      if (mon.activeWorkspace && mon.activeWorkspace.id !== undefined)
        activeWs = mon.activeWorkspace.id
      else if (ipc.activeWorkspace && ipc.activeWorkspace.id !== undefined)
        activeWs = ipc.activeWorkspace.id
      activeWorkspaces[String(mon.name || "")] = activeWs
      // A visible special workspace (scratchpad) floats above the normal one:
      // its windows are on screen even though their workspace id is negative.
      var specialId = 0
      if (ipc.specialWorkspace && ipc.specialWorkspace.id !== undefined)
        specialId = Number(ipc.specialWorkspace.id) || 0
      specialWorkspaces[String(mon.name || "")] = specialId
    }

    var windows = []
    var toplevels = Hyprland.toplevels.values
    for (var t = 0; t < toplevels.length; t++) {
      var top = toplevels[t]
      if (!top) continue
      var raw = top.lastIpcObject || ({})
      if (raw.mapped === false || raw.hidden === true) continue
      // Hyprland's IPC fields arrive as QVariantList, which is array-like but
      // not necessarily a JS Array: use length/index access, not Array.isArray.
      var atRaw = raw.at
      var sizeRaw = raw.size
      var at = atRaw && atRaw.length >= 2 ? [atRaw[0], atRaw[1]] : [0, 0]
      var size = sizeRaw && sizeRaw.length >= 2 ? [sizeRaw[0], sizeRaw[1]] : [0, 0]
      if (!top.address || size[0] <= 0 || size[1] <= 0) continue
      var workspaceId = -1
      if (raw.workspace && raw.workspace.id !== undefined) workspaceId = raw.workspace.id
      else if (top.workspace && top.workspace.id !== undefined) workspaceId = top.workspace.id
      var monitorName = top.monitor ? String(top.monitor.name || "") : (monitorNames[raw.monitor] || "")
      // Windows on another workspace are mapped but not composited; banking
      // them would leave snow suspended over an empty desktop. Pinned windows
      // follow the user across workspaces, and a shown special workspace sits
      // on top of the normal one.
      var active = activeWorkspaces[monitorName]
      var special = specialWorkspaces[monitorName] || 0
      var onSpecial = special !== 0 && workspaceId === special
      var visibleHere = onSpecial || raw.pinned === true
        || active === undefined || active < 0 || workspaceId === active
      if (!visibleHere) continue
      // Recent Hyprland versions report `fullscreen` as a number (0 none,
      // 1 maximized, 2 fullscreen, 3 both); older ones as a boolean. Only real
      // fullscreen hides the overlay, so a maximized window must not pause it.
      var fs = raw.fullscreen
      var isFullscreen = fs === true || fs === 2 || fs === 3
      var focus = Number(raw.focusHistoryID)
      windows.push({
        id: String(top.address),
        monitorName: monitorName,
        workspaceId: workspaceId,
        x: at[0],
        y: at[1],
        width: size[0],
        height: size[1],
        floating: raw.floating === true,
        fullscreen: isFullscreen,
        special: onSpecial,
        focusRank: isFinite(focus) && focus >= 0 ? focus : 1000
      })
    }
    return { monitors: monitors, windows: windows }
  }

  function refreshGeometry() {
    if (!overlayMapped) return
    refreshCount++
    Hyprland.refreshToplevels()
    geometrySettle.restart()
  }

  function applyGeometry() {
    var input = collectGeometryInput()
    applyCount++
    lastInputWindows = input.windows.length
    var stamp = Date.now()
    var dt = geometryTime > 0 ? (stamp - geometryTime) / 1000 : 1 / 60
    geometryTime = stamp
    var fullscreenByMonitor = ({})
    for (var w = 0; w < input.windows.length; w++) {
      if (input.windows[w].fullscreen)
        fullscreenByMonitor[input.windows[w].monitorName] = true
    }
    var modelChanged = WindowGeometry.update(geometryState, input, dt)
    if (modelChanged) geometryRevision++
    // Always push the model, even when raw geometry is unchanged: settings
    // such as accumulateOnWindows can change the desired surface set.
    geometrySnapshot = WindowGeometry.snapshot(geometryState)
    trackedWindows = Object.keys(geometrySnapshot.windows).length
    var total = 0
    for (var name in simulations) {
      syncSimulationSize(name)
      SimulationModule.setGeometry(simulations[name], geometrySnapshot, name)
      SimulationModule.setPaused(simulations[name],
        settings.pauseOnFullscreen && fullscreenByMonitor[name] === true)
      total += simulations[name].surfaces.length
    }
    bankCount = total
  }

  // A mode change (resolution, scale, rotation) resizes a screen without
  // changing the screen list, so screensChanged never fires. Keep the particle
  // field matched to the real surface size on every geometry round instead.
  function syncSimulationSize(name) {
    var sim = simulations[name]
    if (!sim) return
    for (var i = 0; i < Quickshell.screens.length; i++) {
      var screen = Quickshell.screens[i]
      if (screen.name !== name) continue
      if (sim.system.width !== screen.width || sim.system.height !== screen.height)
        SimulationModule.resize(sim, screen.width, screen.height)
      return
    }
  }

  // Read-only simulation diagnostics. There is at most one vehicle per monitor;
  // the counters are cumulative per monitor, so summing them reports the whole
  // desktop without handing a mutable object out of the simulation.
  function plowCount() {
    var n = 0
    for (var name in simulations) if (simulations[name] && simulations[name].plow) n++
    return n
  }

  function simTotal(field) {
    var total = 0
    for (var name in simulations) {
      var sim = simulations[name]
      if (sim && typeof sim[field] === "number") total += sim[field]
    }
    return Math.round(total)
  }

  Timer {
    id: geometrySettle
    interval: 60
    repeat: false
    onTriggered: snowglobe.applyGeometry()
  }

  // Bounded polling: fast for a short window after a geometry-related
  // Hyprland event, idle otherwise. The interval is set imperatively because
  // Date.now() cannot drive a binding.
  Timer {
    id: geometryPoll
    interval: Constants.POLL_IDLE_MS
    repeat: true
    running: snowglobe.overlayMapped
    onTriggered: {
      geometryPoll.interval = snowglobe.fastUntil > Date.now()
        ? Constants.POLL_FAST_MS : Constants.POLL_IDLE_MS
      snowglobe.refreshGeometry()
    }
  }

  // Hyprland event names carry versions (movewindowv2, workspacev2, ...).
  // The old list also named "windowadded"/"windowremoved", which Hyprland never
  // sends, so opening or closing a window did not trigger fast polling.
  function isGeometryEvent(name) {
    var base = String(name || "").replace(/v[0-9]+$/, "")
    return Constants.FAST_POLL_EVENTS.indexOf(base) >= 0
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!snowglobe.isGeometryEvent(event && event.name)) return
      snowglobe.fastUntil = Date.now() + Constants.FAST_POLL_WINDOW_MS
      if (geometryPoll.interval !== Constants.POLL_FAST_MS) {
        geometryPoll.interval = Constants.POLL_FAST_MS
        if (geometryPoll.running) geometryPoll.restart()
      }
    }
  }

  Connections {
    target: Quickshell
    function onScreensChanged() {
      snowglobe.rebuildSimulations()
      snowglobe.refreshGeometry()
    }
  }

  onSettingsChanged: {
    applySimulationSettings()
    if (!settings.builderEnabled) exitBuilder()
  }
  // Builder mode only makes sense on a mapped overlay. Leaving it here (rather
  // than only masking it in the surface binding) means a pause, a disable or a
  // blocked compositor can never bring back an exclusive-focus surface later.
  onOverlayMappedChanged: {
    if (overlayMapped) refreshGeometry()
    else exitBuilder()
  }
  // Count mapped surfaces, not delegate instances: a disabled plugin keeps its
  // delegates alive but unmaps them, which is the zero-cost state we want to
  // report honestly in diagnostics.
  readonly property int surfaceCount: overlayMapped ? overlayVariants.instances.length : 0

  // One surface per screen, rebuilt when the screen list changes. A removed
  // monitor's surface is destroyed with its delegate rather than recycled.
  Variants {
    id: overlayVariants
    model: Quickshell.screens

    OverlaySurface {
      passive: snowglobe.overlayMapped
      behind: snowglobe.settings.layer !== "above"
      simulation: snowglobe.simulations[modelData.name]
      builderActive: snowglobe.builderActive && snowglobe.overlayMapped
      service: snowglobe
      snowmen: snowglobe.snowmen
      snowmenRevision: snowglobe.snowmenRevision
    }
  }

  onModeChanged: {
    if (!overlayMapped)
      for (var name in simulations) SimulationModule.resetMetrics(simulations[name])
    console.log("[snowglobe] mode=" + mode + " surfaces=" + surfaceCount)
  }

  // ---- Persistent snowmen ------------------------------------------------
  // Strictly validated, atomically written, and never overwritten while
  // invalid: a corrupt document is copied aside before defaults are used.
  readonly property string statePath: {
    var base = Quickshell.env("XDG_STATE_HOME")
    if (!base) base = Quickshell.env("HOME") + "/.local/state"
    return base + "/snowglobe/state.json"
  }

  property string stateStatus: "not loaded"
  property bool stateDirty: false
  property int idCounter: 0

  function applyState(text) {
    var parsed = StateModule.parse(String(text || ""))
    if (!parsed.ok) {
      quarantineFile.path = snowglobe.statePath + ".invalid." + Date.now()
      quarantineFile.setText(String(text || ""))
      stateStatus = "invalid: " + parsed.reason + " (quarantined)"
      snowmen = []
      snowmenRevision++
      syncSnowmenToSimulations()
      return
    }
    stateStatus = "ok: " + parsed.state.snowmen.length + " snowmen"
    if (parsed.reason !== "") stateStatus += " (" + parsed.reason + ")"
    snowmen = parsed.state.snowmen
    snowmenRevision++
    syncSnowmenToSimulations()
  }

  function persistState() {
    if (!stateDirty) return
    var doc = {
      version: StateModule.STATE_VERSION,
      snowmen: snowmen,
      savedAt: Date.now()
    }
    var checked = StateModule.normalize(doc)
    if (!checked.ok) {
      stateStatus = "refusing invalid write: " + checked.reason
      return
    }
    stateFile.setText(StateModule.serialize(checked.state))
    stateStatus = "saved: " + snowmen.length + " snowmen"
    stateDirty = false
  }

  // Reassign the array so QML bindings on `snowmen` re-evaluate, then debounce
  // the write: dragging a ball produces many changes but one file update.
  function markSnowmenChanged() {
    var next = snowmen.slice()
    snowmen = next
    snowmenRevision++
    syncSnowmenToSimulations()
    stateDirty = true
    saveTimer.restart()
  }

  function nextSnowmanId() {
    idCounter++
    return "snow-" + Date.now() + "-" + idCounter
  }

  function findSnowman(id) {
    return SnowmanModel.findSnowman(snowmen, id)
  }

  function createSnowman(monitor, x, y, radius) {
    // IPC arguments arrive as strings; coerce at the boundary so the model and
    // the persisted document always contain numbers.
    var px = Number(x)
    var py = Number(y)
    if (!isFinite(px) || !isFinite(py)) return ""
    if (snowmen.length >= StateModule.MAX_SNOWMEN) return ""
    var r = radius === undefined ? SnowmanModel.radiusForStack(0) : Number(radius)
    var item = SnowmanModel.create(nextSnowmanId(), String(monitor || ""), px, py, Date.now())
    SnowmanModel.addBall(item, px, py, r)
    snowmen.push(item)
    markSnowmenChanged()
    return item.id
  }

  function addStackedBall(monitor, id, targetIndex, x, y, radius) {
    var item = findSnowman(id)
    if (!item || item.balls.length >= StateModule.MAX_BALLS) return false
    var r = radius === undefined ? undefined : Number(radius)
    var added = SnowmanModel.addStackedBall(item, Number(targetIndex), Number(x), Number(y), r)
    if (added < 0) return false
    markSnowmenChanged()
    return true
  }

  // ---- Snowball rolling ---------------------------------------------------
  // The builder drags a snowball across piles of snow. These three calls are
  // the whole contract between the pointer and the snow: take snow under a
  // brush, hand it back, and drop the finished ball.
  function gatherSnow(monitor, x, y, brushRadius, amount, maxArea) {
    var sim = simulations[String(monitor || "")]
    if (!sim) return 0
    return SimulationModule.gather(sim, Number(x), Number(y), Number(brushRadius),
      Number(amount), Number(maxArea) || 0)
  }

  function returnSnow(monitor, x, y, area) {
    var sim = simulations[String(monitor || "")]
    if (!sim) return 0
    return SimulationModule.returnSnow(sim, Number(x), Number(y), Number(area))
  }

  // The pointer only sets a target. Simulation.step() moves the ball with
  // acceleration/deceleration and gathers along the eased path every frame.
  function beginRoll(monitor, x, y) {
    var sim = simulations[String(monitor || "")]
    if (!sim) return null
    return SimulationModule.beginRoll(sim, Number(x), Number(y))
  }

  function setRollTarget(monitor, x, y) {
    var sim = simulations[String(monitor || "")]
    if (!sim) return false
    return SimulationModule.setRollTarget(sim, Number(x), Number(y))
  }

  function rollState(monitor) {
    var sim = simulations[String(monitor || "")]
    return sim ? SimulationModule.rollState(sim) : null
  }

  // Release: gather the final leg to the pointer, then hand the ball back at
  // the release point. Aborts use takeRoll() instead and keep the current spot.
  function finishRoll(monitor) {
    var sim = simulations[String(monitor || "")]
    return sim ? SimulationModule.finishRoll(sim) : null
  }

  // Give an abandoned roll back to the builder. Its gathered area is intact
  // even if the gesture was interrupted.
  function takeRoll(monitor) {
    var sim = simulations[String(monitor || "")]
    return sim ? SimulationModule.takeRoll(sim) : null
  }

  // Drop a rolled ball. It stacks on a nearby snowman, or becomes a new one
  // resting on the surface below the pointer (a window top or the ground).
  // Returns { ok, action: "stack"|"new"|"", id }.
  function placeRolledBall(monitor, x, y, radius) {
    var name = String(monitor || "")
    var px = Number(x)
    var py = Number(y)
    var r = SnowmanModel.clampRadius(Number(radius))
    if (!isFinite(px) || !isFinite(py)) return { ok: false, action: "", id: "" }

    var target = SnowmanModel.stackTarget(snowmen, name, px, py, r)
    if (target) {
      var base = target.snowman.balls[target.index]
      var stackR = SnowmanModel.stackRadius(base, r)
      if (!addStackedBall(name, target.snowman.id, target.index, px, py, stackR))
        return { ok: false, action: "", id: target.snowman.id }
      return { ok: true, action: "stack", id: target.snowman.id }
    }

    // Come to rest on whatever is below the release point. A ball released in
    // mid-air settles onto the first surface under it; it creeps a little
    // downhill, presses a soft impression into the snow and is nudged clear of
    // nearby balls. With no surface below, it stays where it was dropped.
    var cx = px
    var cy = py
    var sim = simulations[name]
    if (sim) {
      var settled = SimulationModule.settleBall(sim, px, py, r, snowmen)
      cx = settled.x
      cy = settled.y
    }
    var id = createSnowman(name, cx, cy, r)
    return { ok: id !== "", action: id !== "" ? "new" : "", id: id }
  }

  function moveBall(id, index, x, y) {
    var item = findSnowman(id)
    if (!item || !SnowmanModel.moveBall(item, Number(index), Number(x), Number(y))) return false
    markSnowmenChanged()
    return true
  }

  function moveSnowman(id, dx, dy) {
    var item = findSnowman(id)
    if (!item || !SnowmanModel.moveSnowman(item, Number(dx), Number(dy))) return false
    markSnowmenChanged()
    return true
  }

  function snapBall(id, index, targetIndex) {
    var item = findSnowman(id)
    index = Number(index)
    targetIndex = Number(targetIndex)
    if (!item || index === targetIndex) return false
    var ball = item.balls[index]
    var target = item.balls[targetIndex]
    if (!ball || !target) return false
    ball.r = SnowmanModel.radiusForStack(Math.max(index, targetIndex))
    if (index < targetIndex) target.r = Math.max(target.r, ball.r)
    var position = SnowmanModel.stackedPosition(target, ball.r)
    ball.x = position.x
    ball.y = position.y
    markSnowmenChanged()
    return true
  }

  function addDecoration(id, type, ballIndex, dx, dy) {
    var item = findSnowman(id)
    if (!item) return false
    if (SnowmanModel.addDecoration(item, String(type), Number(ballIndex), Number(dx), Number(dy)) < 0) return false
    markSnowmenChanged()
    return true
  }

  function deleteBall(id, index) {
    var item = findSnowman(id)
    if (!item || !SnowmanModel.removeBall(item, Number(index))) return false
    if (item.balls.length === 0) SnowmanModel.deleteSnowman(snowmen, id)
    markSnowmenChanged()
    return true
  }

  function deleteSnowman(id) {
    if (!SnowmanModel.deleteSnowman(snowmen, id)) return false
    markSnowmenChanged()
    return true
  }

  function clearSnowmen() {
    if (snowmen.length === 0) return false
    snowmen = []
    markSnowmenChanged()
    return true
  }

  function enterBuilder() {
    if (!settings.builderEnabled || !overlayMapped) return false
    builderActive = true
    return true
  }

  function exitBuilder() {
    if (!builderActive) return false
    builderActive = false
    persistState()
    return true
  }

  FileView {
    id: stateFile
    path: snowglobe.statePath
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: snowglobe.applyState(text())
    onLoadFailed: snowglobe.stateStatus = "missing or unreadable"
    onSaveFailed: snowglobe.stateStatus = "save failed"
  }

  FileView {
    id: quarantineFile
    path: ""
    watchChanges: false
    atomicWrites: true
    printErrors: false
  }

  Timer {
    id: saveTimer
    interval: 600
    repeat: false
    onTriggered: snowglobe.persistState()
  }

  // ---- Compositor transparency probe ---------------------------------------
  // One `hyprctl` call at start-up. Nothing is mapped until it answers or times
  // out, so the overlay can never flash black on an affected system.
  function startCompositorProbe() {
    compositorState = Compositor.CHECKING
    compositorReason = ""
    probeTimeout.restart()
    compositorProbe.running = false
    compositorProbe.running = true
  }

  function finishCompositorProbe(text) {
    if (compositorState !== Compositor.CHECKING) return
    probeTimeout.stop()
    var result = Compositor.parseQuirkProbe(text)
    compositorState = result.state
    compositorReason = result.reason
    console.log("[snowglobe] compositor transparency: " + compositorState
      + (compositorReason ? " (" + compositorReason + ")" : ""))
    if (compositorState === Compositor.UNSAFE && settings.transparencyGuard)
      console.warn("[snowglobe] overlay blocked: Hyprland strips alpha from client buffers, "
        + "a transparent full-screen surface would render black. Set "
        + Compositor.QUIRK_OPTION + " = false, restart Hyprland, then the shell.")
  }

  Process {
    id: compositorProbe
    command: ["hyprctl", "-j", "getoption", Compositor.QUIRK_OPTION]
    running: false
    stdout: StdioCollector {
      id: probeOutput
      onStreamFinished: snowglobe.finishCompositorProbe(probeOutput.text)
    }
  }

  Timer {
    id: probeTimeout
    interval: Constants.COMPOSITOR_PROBE_TIMEOUT_MS
    repeat: false
    onTriggered: snowglobe.finishCompositorProbe("")
  }

  // ---- Diagnostics / control --------------------------------------------
  // Read-only status plus two transient pause controls. Every value is bounded
  // and derived from local state; no caller-supplied path or code is accepted.
  ShellIpc {
    target: "snowglobe"

    function status(): string {
      return JSON.stringify({
        version: snowglobe.version,
        mode: snowglobe.mode,
        enabled: snowglobe.settings.enabled,
        overlay: snowglobe.settings.overlay,
        layer: snowglobe.settings.layer,
        quality: snowglobe.settings.quality,
        adaptiveScale: snowglobe.adaptiveScale,
        paused: snowglobe.paused,
        compositor: snowglobe.compositorState,
        compositorReason: snowglobe.compositorReason,
        transparencyGuard: snowglobe.settings.transparencyGuard,
        surfaces: snowglobe.surfaceCount,
        screens: snowglobe.screenCount,
        trackedWindows: snowglobe.trackedWindows,
        snowBanks: snowglobe.bankCount,
        geometryRevision: snowglobe.geometryRevision,
        builder: snowglobe.builderActive,
        snowmen: snowglobe.snowmen.length,
        plows: snowglobe.plowCount(),
        plowCollected: snowglobe.simTotal("plowCollected"),
        plowUnloaded: snowglobe.simTotal("plowUnloaded"),
        avalanches: snowglobe.simTotal("avalancheEvents"),
        avalancheArea: snowglobe.simTotal("avalancheArea"),
        state: snowglobe.stateStatus
      })
    }

    // Re-run the transparency probe, e.g. after fixing the Hyprland option and
    // restarting Hyprland without restarting the shell.
    function recheckCompositor(): string {
      snowglobe.startCompositorProbe()
      return JSON.stringify({ state: snowglobe.compositorState })
    }

    function pause(): void { snowglobe.paused = true }
    function resume(): void { snowglobe.paused = false }

    // ---- Snowman builder control -----------------------------------------
    function builderEnter(): string {
      return JSON.stringify({ ok: snowglobe.enterBuilder(), active: snowglobe.builderActive })
    }
    function builderExit(): string {
      return JSON.stringify({ ok: snowglobe.exitBuilder(), active: snowglobe.builderActive })
    }
    function builderToggle(): string {
      if (snowglobe.builderActive) return builderExit()
      return builderEnter()
    }
    function builderStatus(): string {
      return JSON.stringify({
        active: snowglobe.builderActive,
        enabled: snowglobe.settings.builderEnabled,
        snowmen: snowglobe.snowmen.length,
        state: snowglobe.stateStatus
      })
    }

    // Reads only ids, monitor names and geometry — never titles or contents.
    function snowmanDump(): string {
      return JSON.stringify(snowglobe.snowmen)
    }
    function snowmen(): string {
      return JSON.stringify(snowglobe.snowmen.map(function(item) {
        return {
          id: item.id, monitor: item.monitor, balls: item.balls.length,
          decorations: item.decorations.length, createdAt: item.createdAt
        }
      }))
    }
    // Scripted construction helper: same path the builder UI uses, without
    // requiring a pointer event. Useful for accessibility and testing.
    function snowmanCreate(monitor: string, x: number, y: number): string {
      return JSON.stringify({ id: snowglobe.createSnowman(monitor, x, y) })
    }
    // Same path the roller uses to drop a finished ball, for scripted tests.
    function snowmanDrop(monitor: string, x: number, y: number, radius: number): string {
      return JSON.stringify(snowglobe.placeRolledBall(monitor, x, y, radius))
    }
    // Take snow under a brush, as the roller does; returns the area gathered.
    function snowGather(monitor: string, x: number, y: number, radius: number): string {
      return JSON.stringify({ area: snowglobe.gatherSnow(monitor, x, y, radius, 0.5, 0) })
    }
    function snowmanAddBall(id: string, targetIndex: number, x: number, y: number): string {
      return JSON.stringify({ ok: snowglobe.addStackedBall(
        monitorNameFromId(id), id, targetIndex, x, y) })
    }

    function monitorNameFromId(id: string): string {
      var item = snowglobe.findSnowman(id)
      return item ? item.monitor : ""
    }

    function deleteSnowman(id: string): string {
      return JSON.stringify({ ok: snowglobe.deleteSnowman(id) })
    }
    function clearSnowmen(): string {
      return JSON.stringify({ ok: snowglobe.clearSnowmen() })
    }
    function saveNow(): string {
      snowglobe.persistState()
      return JSON.stringify({ state: snowglobe.stateStatus })
    }

    // Force a geometry collection round; useful when verifying a compositor
    // configuration without waiting for the bounded poll.
    function syncGeometry(): string {
      snowglobe.applyGeometry()
      return snowglobe.geometry()
    }

    // Diagnose the raw IPC view without exposing window titles or contents.
    function probe(): string {
      var tops = Hyprland.toplevels ? Hyprland.toplevels.values : []
      var sample = tops.length > 0 ? (tops[0].lastIpcObject || ({})) : ({})
      return JSON.stringify({
        toplevels: tops.length,
        monitors: Hyprland.monitors ? Hyprland.monitors.values.length : 0,
        pollRunning: geometryPoll.running,
        refreshCount: snowglobe.refreshCount,
        applyCount: snowglobe.applyCount,
        lastInputWindows: snowglobe.lastInputWindows,
        collectedWindows: snowglobe.collectGeometryInput().windows.length,
        modelWindows: Object.keys(snowglobe.geometryState.windows).length,
        settleActive: geometrySettle.active,
        sample: {
          address: tops.length > 0 ? String(tops[0].address || "") : "",
          mapped: sample.mapped,
          hidden: sample.hidden,
          at: sample.at,
          size: sample.size,
          hasMonitor: tops.length > 0 ? !!tops[0].monitor : false
        }
      })
    }

    // Read-only geometry view for integration checks. No window titles or
    // application contents are exposed — only ids, monitors and rectangles.
    function geometry(): string {
      var snapshot = snowglobe.geometrySnapshot || ({})
      var monitors = []
      for (var m in (snapshot.monitors || {})) monitors.push(m)
      var windows = []
      for (var w in (snapshot.windows || {})) {
        var item = snapshot.windows[w]
        windows.push({
          id: w, monitor: item.monitorName, workspace: item.workspaceId,
          x: item.x, y: item.y, width: item.width, height: item.height,
          moved: item.hasMoved === true, resized: item.hasResized === true
        })
      }
      return JSON.stringify({
        revision: snowglobe.geometryRevision,
        monitors: monitors,
        windows: windows,
        gone: snapshot.gone || []
      })
    }

    // Per-monitor frame/step timings. Values are measured in situ by the
    // simulation and renderer, not estimated.
    function metrics(): string {
      var out = ({})
      for (var name in snowglobe.simulations) {
        var entry = SimulationModule.metrics(snowglobe.simulations[name])
        if (!snowglobe.overlayMapped) {
          entry.stepsPerSecond = 0
          entry.paintsPerSecond = 0
          entry.avgStepMs = 0
          entry.avgPaintMs = 0
        }
        out[name] = entry
      }
      return JSON.stringify(out)
    }

    // Reset every particle field without touching preferences or state.
    function clear(): void {
      for (var name in snowglobe.simulations)
        SimulationModule.reset(snowglobe.simulations[name])
    }
  }

  // ---- Cleanup -----------------------------------------------------------
  // Renderer timers stop with their surfaces; dropping the simulation map
  // releases every typed-array buffer when the service is destroyed.
  function shutdown() {
    builderActive = false
    paused = false
    if (stateDirty) persistState()
    snowmen = []
    stateStatus = "not loaded"
    simulations = ({})
  }

  Component.onDestruction: {
    snowglobe.shutdown()
    console.log("[snowglobe] service stopped")
  }

  Component.onCompleted: {
    startCompositorProbe()
    rebuildSimulations()
    // Collect geometry once even if the plugin starts disabled, so diagnostics
    // are meaningful immediately and banks exist as soon as it is enabled.
    applyGeometry()
    console.log("[snowglobe] service ready v" + version + " mode=" + mode
      + " monitors=" + screenCount + " windows=" + trackedWindows)
  }
}
