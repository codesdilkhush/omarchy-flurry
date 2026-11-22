// Fixed-step snowfall simulation.
//
// Pure JavaScript: no Qt, no Hyprland, no rendering. Every dependency is
// injected by the caller (a particle system, its module, a random function),
// because QML JavaScript files cannot import other JavaScript files.
//
// The loop uses a fixed timestep with an accumulator. A long frame-time spike
// (suspend, focus change) is clamped so the simulation never tries to catch up
// with an unbounded number of steps.

var GRAVITY_TERMINAL_BASE = 24;   // px/s at radius 0
var GRAVITY_TERMINAL_PER_R = 12;  // extra px/s per logical pixel of radius
var FALL_APPROACH = 1.7;          // how fast vy approaches terminal velocity
var WIND_FORCE_PER_UNIT = 18;     // px/s of lateral drift at wind = 1
var WIND_APPROACH = 1.2;
var SWAY_BASE = 3;
var SWAY_PER_R = 2;
var RESPAWN_MARGIN = 8;

function create(config) {
  var cfg = config || {};
  var sim = {
    system: cfg.system,
    particles: cfg.particleSystem,
    random: typeof cfg.random === "function" ? cfg.random : Math.random,
    stepSeconds: cfg.stepSeconds > 0 ? cfg.stepSeconds : 1 / 60,
    maxStepsPerFrame: cfg.maxStepsPerFrame > 0 ? cfg.maxStepsPerFrame : 5,
    maxBacklogSeconds: cfg.maxBacklogSeconds > 0 ? cfg.maxBacklogSeconds : 0.25,
    capacities: cfg.capacities || { low: 250, balanced: 600, high: 1200 },
    density: cfg.density === undefined ? 1 : cfg.density,
    wind: cfg.wind === undefined ? 1 : cfg.wind,
    quality: cfg.quality || "balanced",
    adaptiveScale: cfg.adaptiveScale > 0 ? cfg.adaptiveScale : 1,
    paused: cfg.paused === true,
    frameIntervalMs: cfg.frameIntervalMs > 0 ? cfg.frameIntervalMs : 1000 / 60,
    // Accumulation dependencies are injected (QML cannot import JS modules).
    bankModule: cfg.bankModule || null,
    collisionModule: cfg.collisionModule || null,
    // Detached snow lives in its own bounded pool so it can inherit window
    // velocity without disturbing the steady snowfall count.
    detachedSystem: cfg.detachedSystem || null,
    // Rolling snowball and its impressions. Both modules are injected because
    // QML JavaScript files cannot import other JS files. The roll lives here so
    // the existing MonitorScene frame loop can advance it with the fixed step.
    rollModule: cfg.rollModule || null,
    tracksModule: cfg.tracksModule || null,
    // The snow plow is another pure-JS subsystem advanced by this same loop.
    // One vehicle per monitor; the model owns its state machine and spawns it
    // only when the ground bank passes the configured threshold.
    plowModule: cfg.plowModule || null,
    plowEnabled: cfg.plowEnabled !== false,
    plow: null,
    plowCooldown: 0,
    plowSpawnDepth: cfg.plowSpawnDepth === undefined ? 3.2 : cfg.plowSpawnDepth,
    plowDespawnDepth: cfg.plowDespawnDepth === undefined ? 1 : cfg.plowDespawnDepth,
    plowCooldownSeconds: cfg.plowCooldownSeconds === undefined ? 3 : cfg.plowCooldownSeconds,
    plowCapacity: cfg.plowCapacity || 640,
    plowSpeed: cfg.plowSpeed || 88,
    plowLoadedSpeedFactor: cfg.plowLoadedSpeedFactor === undefined ? 0.45 : cfg.plowLoadedSpeedFactor,
    plowScoopRadius: cfg.plowScoopRadius || 13,
    plowScoopAmount: cfg.plowScoopAmount === undefined ? 0.16 : cfg.plowScoopAmount,
    plowUnloadSeconds: cfg.plowUnloadSeconds === undefined ? 0.7 : cfg.plowUnloadSeconds,
    plowDustEvery: cfg.plowDustEvery === undefined ? 0.09 : cfg.plowDustEvery,
    plowSnowmanMargin: cfg.plowSnowmanMargin === undefined ? 20 : cfg.plowSnowmanMargin,
    plowTrackRadius: cfg.plowTrackRadius || 9,
    plowTrackStrength: cfg.plowTrackStrength === undefined ? 0.5 : cfg.plowTrackStrength,
    plowSpawns: 0,
    plowCollected: 0,
    plowUnloaded: 0,
    // Environmental polish: rare avalanches and physical settling of dropped
    // balls. Both are advanced by this same step, with no extra timers.
    avalancheMinDepth: cfg.avalancheMinDepth === undefined ? 16 : cfg.avalancheMinDepth,
    avalancheChance: cfg.avalancheChance === undefined ? 0.06 : cfg.avalancheChance,
    avalancheCooldown: cfg.avalancheCooldown === undefined ? 8 : cfg.avalancheCooldown,
    avalancheSlideAmount: cfg.avalancheSlideAmount === undefined ? 2.4 : cfg.avalancheSlideAmount,
    avalancheShedMass: cfg.avalancheShedMass === undefined ? 4 : cfg.avalancheShedMass,
    avalancheCheckSeconds: cfg.avalancheCheckSeconds === undefined ? 0.5 : cfg.avalancheCheckSeconds,
    avalancheTimer: 0,
    avalancheEvents: 0,
    avalancheArea: 0,
    settleRollSteps: cfg.settleRollSteps === undefined ? 3 : cfg.settleRollSteps,
    settleRollGain: cfg.settleRollGain === undefined ? 0.18 : cfg.settleRollGain,
    settleCompactAmount: cfg.settleCompactAmount === undefined ? 0.16 : cfg.settleCompactAmount,
    settleSinkFraction: cfg.settleSinkFraction === undefined ? 0.92 : cfg.settleSinkFraction,
    // Smoothed landings per second: tracks are buried by *actual* accumulation,
    // not just by the density setting.
    snowfallRate: 0,
    // Plain snowman records for this monitor, pushed by the service. The plow
    // only reads them to steer clear of user-built snowmen.
    snowmen: [],
    maxTracks: cfg.maxTracks || 192,
    tracks: cfg.tracksModule ? cfg.tracksModule.create(cfg.maxTracks || 192) : null,
    roll: null,
    slideSpeed: cfg.slideSpeed || 40,
    detachSpeed: cfg.detachSpeed || 180,
    // Window sliding and bank settling are different rates. A duplicate
    // `slideAmount` key used to overwrite this with the bank value, so the
    // configured windowSlideAmount never took effect.
    windowSlideAmount: cfg.windowSlideAmount === undefined ? 1.2 : cfg.windowSlideAmount,
    detachMass: cfg.detachMass || 2.5,
    detachMaxPerEvent: cfg.detachMaxPerEvent || 6,
    velocityInherit: cfg.velocityInherit === undefined ? 0.55 : cfg.velocityInherit,
    detachedGravity: cfg.detachedGravity || 140,
    detachedLift: cfg.detachedLift === undefined ? 14 : cfg.detachedLift,
    mediumDepth: cfg.mediumDepth || 6,
    heavyDepth: cfg.heavyDepth || 12,
    mediumMass: cfg.mediumMass || 4.5,
    heavyMass: cfg.heavyMass || 8,
    chunkChance: cfg.chunkChance === undefined ? 0.45 : cfg.chunkChance,
    shedKick: cfg.shedKick === undefined ? 0.9 : cfg.shedKick,
    detachments: 0,
    detachedArea: 0,
    landedArea: 0,
    surfaces: [],
    bankRevision: 0,
    limitSignature: "",
    accumulateOnWindows: cfg.accumulateOnWindows !== false,
    maxSurfaces: cfg.maxSurfaces || 96,
    depositAmount: cfg.depositAmount || 1.6,
    depositSpread: cfg.depositSpread === undefined ? 1 : cfg.depositSpread,
    settleSteps: cfg.settleSteps || 45,
    slideAmount: cfg.slideAmount === undefined ? 0.35 : cfg.slideAmount,
    redistributeAmount: cfg.redistributeAmount === undefined ? 0.25 : cfg.redistributeAmount,
    erodeAmount: cfg.erodeAmount === undefined ? 0.01 : cfg.erodeAmount,
    segmentWidth: cfg.segmentWidth || 2,
    windowMaxDepth: cfg.windowMaxDepth || 48,
    groundMaxDepth: cfg.groundMaxDepth || 96,
    stepCount: 0,
    landings: 0,
    monitorName: "",
    time: 0,
    accumulator: 0,
    windCurrent: 0,
    lastLimit: 0,
    metrics: {
      windowSeconds: 0,
      steps: 0,
      stepMs: 0,
      paints: 0,
      paintMs: 0,
      avgStepMs: 0,
      avgPaintMs: 0,
      stepsPerSecond: 0,
      paintsPerSecond: 0,
      frameMs: 0,
      frameDriftMs: 0,
      frameSamples: 0,
      frameMsSum: 0,
      frameDriftSum: 0
    }
  };
  applyLimits(sim);
  return sim;
}

function applyLimits(sim) {
  var cap = sim.capacities[sim.quality] || sim.capacities.balanced || 600;
  // Density 1 intentionally fills about half the quality budget, leaving
  // headroom for the heavier quality modes and for future detached particles.
  var wanted = Math.round(cap * 0.5 * sim.density * sim.adaptiveScale);
  sim.lastLimit = Math.max(0, Math.min(cap, wanted));
  sim.particles.setCount(sim.system, sim.lastLimit);
}

// Synchronize surfaces for one monitor.
//
// Translation and resize take different paths: a translated window keeps its
// bank (snow rides along and may slide or shed), while a resized window keeps
// its profile resampled to the new width but never sheds from that resize.
function setGeometry(sim, snapshot, monitorName) {
  var source = snapshot || {}
  var monitors = source.monitors || {}
  var monitor = monitors[monitorName]
  sim.monitorName = monitorName
  if (!monitor || !sim.bankModule) {
    if (sim.surfaces.length > 0) {
      sim.surfaces = []
      sim.bankRevision++
    }
    return false
  }

  var desired = []
  var originX = monitor.x || 0
  var originY = monitor.y || 0

  // Ground: the monitor's bottom edge, excluding reserved panel space.
  var groundY = (monitor.y || 0) + (monitor.height || 0) - (monitor.reservedBottom || 0)
  desired.push({
    id: "ground:" + monitorName,
    type: "ground",
    x: 0,
    y: groundY - originY,
    width: monitor.width || 0,
    maxDepth: sim.groundMaxDepth,
    window: null
  })

  // Window tops: the exposed horizontal edge of each mapped window.
  if (sim.accumulateOnWindows) {
    var windows = source.windows || {}
    for (var id in windows) {
      var win = windows[id]
      if (win.monitorName !== monitorName) continue
      if (win.width <= 0 || win.fullscreen) continue
      desired.push({
        id: "window:" + id,
        type: "window",
        x: (win.x || 0) - originX,
        y: (win.y || 0) - originY,
        width: win.width,
        maxDepth: sim.windowMaxDepth,
        window: win
      })
      if (desired.length >= sim.maxSurfaces) break
    }
  }

  // Everything that decides how much snow fits above each surface: where the
  // other windows are, which are in front, and where the panel ends. Windows
  // are listed with fullscreen ones included (they still hide what is behind).
  var env = buildEnvironment(sim, monitor, source.windows || {}, monitorName, originX, originY)
  for (var r = 0; r < desired.length; r++)
    if (desired[r].window) desired[r].rank = sim.collisionModule.windowRank(desired[r].window)

  var previous = ({})
  for (var p = 0; p < sim.surfaces.length; p++) previous[sim.surfaces[p].id] = sim.surfaces[p]

  var next = []
  var moved = []
  var changed = false
  for (var d = 0; d < desired.length; d++) {
    var spec = desired[d]
    var old = previous[spec.id]
    var bank = null
    var wasTranslated = false
    if (old && old.bank) {
      var translated = spec.type === "window" && old.width === spec.width
        && (old.x !== spec.x || old.y !== spec.y)
      var resized = spec.type === "window" && old.x === spec.x && old.y === spec.y
        && old.width !== spec.width
      if (translated) {
        // Keep the height map: snow moves with the surface it sits on.
        bank = old.bank
        bank.x = spec.x
        bank.y = spec.y
        wasTranslated = true
        changed = true
      } else if (resized) {
        // Resample the profile across the new width; no detachment.
        bank = old.bank
        bank.x = spec.x
        bank.y = spec.y
        if (sim.bankModule.resize(bank, spec.width)) changed = true
      } else if (old.x === spec.x && old.y === spec.y && old.width === spec.width) {
        bank = old.bank
      } else {
        bank = sim.bankModule.create(spec.id, spec.type, spec.x, spec.y, spec.width,
          sim.segmentWidth, spec.maxDepth)
        changed = true
      }
    } else {
      bank = sim.bankModule.create(spec.id, spec.type, spec.x, spec.y, spec.width,
        sim.segmentWidth, spec.maxDepth)
      changed = true
    }
    var entry = {
      id: spec.id,
      type: spec.type,
      x: spec.x,
      y: spec.y,
      width: spec.width,
      bank: bank
    }
    next.push(entry)
    if (wasTranslated && spec.window && spec.window.hasMoved)
      moved.push({ surface: entry, window: spec.window })
    delete previous[spec.id]
  }
  for (var stale in previous) changed = true
  if (next.length !== sim.surfaces.length) changed = true

  // Limits depend on every window, not just the surface's own: recompute them
  // whenever the layout changed or a bank was created, moved or resized.
  if (env && (changed || env.signature !== sim.limitSignature)) {
    for (var l = 0; l < next.length; l++) {
      var spec2 = desired[l]
      var limits = sim.collisionModule.surfaceLimits(
        { type: spec2.type, id: spec2.id.indexOf("window:") === 0 ? spec2.id.substring(7) : spec2.id,
          x: spec2.x, y: spec2.y, width: spec2.width, rank: spec2.rank },
        sim.segmentWidth, next[l].bank.segments, spec2.maxDepth, env)
      if (sim.bankModule.applyLimits(next[l].bank, limits)) changed = true
    }
    sim.limitSignature = env.signature
  }

  sim.surfaces = next
  for (var m = 0; m < moved.length; m++)
    applyWindowMovement(sim, moved[m].window, moved[m].surface)
  if (changed) sim.bankRevision++
  return changed
}

// Describe the monitor's occluders for Collision.surfaceLimits and build a
// compact signature so unchanged layouts skip the recomputation.
function buildEnvironment(sim, monitor, windows, monitorName, originX, originY) {
  if (!sim.collisionModule || !sim.collisionModule.surfaceLimits) return null
  var list = []
  var parts = [Math.round(monitor.width || 0), Math.round(monitor.reservedTop || 0),
    Math.round(monitor.reservedBottom || 0), Math.round(monitor.height || 0)]
  for (var id in windows) {
    var win = windows[id]
    if (win.monitorName !== monitorName) continue
    if (!(win.width > 0) || !(win.height > 0)) continue
    var entry = {
      id: id,
      x: (win.x || 0) - originX,
      y: (win.y || 0) - originY,
      width: win.width,
      height: win.height,
      rank: sim.collisionModule.windowRank(win)
    }
    list.push(entry)
    parts.push(id, Math.round(entry.x), Math.round(entry.y), Math.round(entry.width),
      Math.round(entry.height), entry.rank)
  }
  return {
    width: monitor.width || 0,
    ceiling: monitor.reservedTop || 0,
    windows: list,
    signature: parts.join("|")
  }
}

// Movement response: rigid below the slide threshold, sliding toward the
// trailing edge, then tiered shedding above the detachment threshold.
//
// Every unit of area removed from a window bank is handed to the falling
// particle(s) as `mass`; those particles deposit the same area when they land.
// Snow therefore rides, slides, breaks and re-accumulates without being
// created or lost in the transition.
function applyWindowMovement(sim, win, surface) {
  var speed = win.speed || 0
  if (speed < sim.slideSpeed) return
  var bank = surface.bank
  if (!bank || !sim.bankModule) return

  // Snow rides with the window until this threshold. Above it the bank creeps
  // toward the trailing edge; the heavy segments that pile up there are the
  // ones that eventually break off.
  var intensity = Math.min(1, speed / sim.detachSpeed)
  var direction = win.dx >= 0 ? -1 : 1
  if (sim.bankModule.slide(bank, direction, sim.windowSlideAmount * intensity))
    sim.bankRevision++

  if (speed < sim.detachSpeed || !sim.detachedSystem || !sim.particles) return
  var free = sim.detachedSystem.capacity - sim.detachedSystem.count
  if (free <= 0) return

  var wanted = Math.min(sim.detachMaxPerEvent, 1 + Math.floor(intensity * sim.detachMaxPerEvent))
  // Scan from the trailing edge inward: the slide above just piled loose snow
  // there, so that is where a chunk can actually leave the rooftop.
  var cursor = direction < 0 ? 0 : bank.segments - 1
  var cursorStep = direction < 0 ? 1 : -1
  var visited = 0
  var emitted = 0
  var transferred = 0

  while (emitted < wanted && visited < bank.segments && free > 0) {
    var index = cursor
    cursor += cursorStep
    visited++
    if (index < 0 || index >= bank.segments) break
    var h = bank.heights[index]
    if (h < sim.detachMass) continue

    // Thin drifts shed one small flake; medium piles split into two tumbling
    // pieces; deep banks slide first and only occasionally break into chunks.
    var tier = h >= sim.heavyDepth ? 2 : (h >= sim.mediumDepth ? 1 : 0)
    if (tier === 2 && sim.random() > sim.chunkChance) continue
    var amount = tier === 2 ? sim.heavyMass : (tier === 1 ? sim.mediumMass : sim.detachMass)
    var pieces = Math.min(tier + 1, free)
    var area = sim.bankModule.takeFromSegment(bank, index, amount)
    if (area <= 0) continue

    var share = area / pieces
    var spin = tier === 0 ? 14 : (tier === 1 ? 48 : 30)
    var radius = tier === 2 ? 3.2 + sim.random() * 1.3
      : (tier === 1 ? 1.8 + sim.random() * 0.9 : 0.9 + sim.random() * 0.7)
    for (var p = 0; p < pieces; p++) {
      var jitter = (sim.random() - 0.5) * sim.detachSpeed * 0.12
      var idx = sim.particles.inject(
        sim.detachedSystem,
        bank.x + (index + 0.5) * bank.segmentWidth + jitter * 0.4,
        bank.y - h,
        // Inherit window momentum, then kick toward the trailing edge so the
        // snow clears the moving rooftop instead of landing straight back.
        (win.vx || 0) * sim.velocityInherit + direction * speed * sim.shedKick + jitter,
        (win.vy || 0) * sim.velocityInherit - sim.detachedLift - sim.random() * 8,
        radius,
        0.55 + sim.random() * 0.3,
        tier,
        1,
        share)
      if (idx < 0) break
      // inject() gives every flake a random spin; tiers set their own tumble
      // rate so medium clusters visibly break apart and heavy chunks roll.
      sim.detachedSystem.vr[idx] = spin * (sim.random() < 0.5 ? -1 : 1)
      emitted++
      free--
    }
    transferred += area
  }
  if (emitted > 0) {
    sim.detachments += emitted
    sim.detachedArea += transferred
    sim.bankRevision++
  }
}

// ---- Snow gathering (snowman roller) ---------------------------------------
// Take snow from every surface under a circular brush. Returns the area
// gathered in square pixels. `maxArea` of 0 means unlimited.
function gather(sim, cx, cy, radius, amount, maxArea) {
  if (!sim.bankModule) return 0
  var total = 0
  for (var i = 0; i < sim.surfaces.length; i++) {
    var remaining = maxArea > 0 ? maxArea - total : 0
    if (maxArea > 0 && remaining <= 0) break
    total += sim.bankModule.scoop(sim.surfaces[i].bank, cx, cy, radius, amount, remaining)
  }
  if (total > 0) sim.bankRevision++
  return total
}

// The surface a ball released at (x, y) would come to rest on: the first
// landable surface at or below that point. Returns { surface, top } or null.
function restingSurface(sim, x, y, slack) {
  if (!sim.bankModule || !sim.collisionModule) return null
  return sim.collisionModule.surfaceBelow(sim.bankModule, sim.surfaces, x, y, slack)
}

// Hand gathered snow back to the surface under (x, y); used when a snowball is
// abandoned or too small to keep. Returns the area actually returned.
function returnSnow(sim, x, y, area) {
  var hit = restingSurface(sim, x, y, 12)
  if (!hit) return 0
  var given = sim.bankModule.giveBack(hit.surface.bank, x, area, 8)
  if (given > 0) sim.bankRevision++
  return given
}

// ---- Rolling snowball -------------------------------------------------------
// The builder only supplies pointer targets and asks for the finished ball.
// Movement, gathering, compaction and contact effects all happen in step(), so
// no extra timer or second physics loop is needed.
function rollGather(sim, cx, cy, radius, amount, maxArea) {
  return gather(sim, cx, cy, radius, amount, maxArea)
}

function beginRoll(sim, x, y) {
  if (!sim || !sim.rollModule) return null
  sim.roll = sim.rollModule.create(Number(x), Number(y))
  // One bound gather callback and one effects array for the whole gesture: the
  // fixed-step loop allocates nothing per frame while the ball is rolling.
  sim.rollGather = function(cx, cy, brush, amount, maxArea) {
    return rollGather(sim, cx, cy, brush, amount, maxArea)
  }
  sim.rollEffects = []
  // Pressing on a pile starts the ball even before the pointer moves.
  sim.rollModule.touch(sim.roll, sim.rollGather)
  return sim.roll
}

function setRollTarget(sim, x, y) {
  if (!sim || !sim.roll || !sim.rollModule) return false
  sim.rollModule.setTarget(sim.roll, Number(x), Number(y))
  return true
}

function rollState(sim) {
  return sim ? sim.roll : null
}

// Hand the roll back to the builder for placement or snow return. The model is
// shared, not copied, so all gathered area survives an interrupted gesture.
function takeRoll(sim) {
  if (!sim || !sim.roll) return null
  var roll = sim.roll
  sim.roll = null
  return roll
}

// Release: sweep the remaining leg to the pointer, then hand the ball back.
// This keeps placement at the release point even after a fast flick where the
// eased ball had not yet caught up with the cursor.
function finishRoll(sim) {
  if (!sim || !sim.roll || !sim.rollModule) return null
  var effects = sim.rollEffects || []
  effects.length = 0
  if (sim.rollModule.settle) sim.rollModule.settle(sim.roll, sim.rollGather, effects)
  processRollEffects(sim, effects)
  return takeRoll(sim)
}

function processRollEffects(sim, effects) {
  if (!effects || effects.length === 0) return
  for (var i = 0; i < effects.length; i++) {
    var e = effects[i]
    if (e.type === "track") {
      if (sim.tracks && sim.tracksModule)
        sim.tracksModule.stamp(sim.tracks, e.x, e.y, e.radius, e.strength)
    } else if (sim.particles && sim.detachedSystem) {
      // Contact dust is decorative (settle = 0): it never deposits into a bank,
      // so the snow counted in roll.area cannot be duplicated on the ground.
      sim.particles.inject(sim.detachedSystem, e.x, e.y, e.vx || 0, e.vy || 0,
        e.radius || 1, 0.45, e.type === "attract" ? 0 : 1, 0)
    }
  }
}

function setAccumulateOnWindows(sim, enabled) {
  sim.accumulateOnWindows = enabled === true
}

function setPlowEnabled(sim, enabled) {
  var next = enabled === true
  if (sim.plowEnabled === next) return
  sim.plowEnabled = next
  if (!next) sim.plow = null
}

// Snowmen are owned by the service. Hand the simulation the plain records so
// the plow can keep clear of user-built snowmen; the model filters by monitor.
function setSnowmen(sim, snowmen) {
  sim.snowmen = snowmen || []
}

function setPaused(sim, paused) {
  sim.paused = paused === true
}

function setAdaptiveScale(sim, scale) {
  var value = typeof scale === "number" && isFinite(scale) ? scale : 1
  var next = Math.max(0.1, Math.min(1, value))
  if (next === sim.adaptiveScale) return false
  sim.adaptiveScale = next
  applyLimits(sim)
  return true
}

function setDensity(sim, density) {
  sim.density = density;
  applyLimits(sim);
}

function setWind(sim, wind) {
  sim.wind = wind;
}

function setQuality(sim, quality) {
  sim.quality = quality;
  applyLimits(sim);
}

function resize(sim, width, height) {
  sim.particles.resize(sim.system, width, height);
  if (sim.detachedSystem) sim.particles.resize(sim.detachedSystem, width, height);
}

function clearBanks(sim) {
  if (!sim.bankModule) return
  for (var i = 0; i < sim.surfaces.length; i++) sim.bankModule.clear(sim.surfaces[i].bank)
  sim.bankRevision++
}

function reset(sim) {
  sim.particles.reset(sim.system);
  if (sim.detachedSystem) sim.detachedSystem.count = 0;
  clearBanks(sim);
  sim.time = 0;
  sim.accumulator = 0;
  sim.windCurrent = 0;
  sim.landings = 0;
  sim.detachments = 0;
  sim.stepCount = 0;
  sim.roll = null;
  sim.rollGather = null;
  if (sim.rollEffects) sim.rollEffects.length = 0;
  sim.plow = null;
  sim.plowCooldown = 0;
  sim.plowSpawns = 0;
  sim.plowCollected = 0;
  sim.plowUnloaded = 0;
  sim.avalancheTimer = 0;
  sim.avalancheEvents = 0;
  sim.avalancheArea = 0;
  sim.snowfallRate = 0;
  for (var s = 0; s < sim.surfaces.length; s++) sim.surfaces[s].avalancheCooldown = 0;
  if (sim.tracks && sim.tracksModule) sim.tracksModule.clear(sim.tracks);
}

// One fixed physics step. Kept separate so unit tests can drive it directly.
function step(sim, dt) {
  var s = sim.system;
  var n = s.count;
  var i;
  var landingsBefore = sim.landings;

  // Wind target plus two slow gusts. Gusts are deterministic functions of
  // simulation time, so a seed plus a timestamp reproduces the whole field.
  var gust = Math.sin(sim.time * 0.55) * sim.wind * 6
    + Math.sin(sim.time * 1.7 + 1.3) * sim.wind * 3;
  var target = sim.wind * WIND_FORCE_PER_UNIT + gust;
  sim.windCurrent += (target - sim.windCurrent) * WIND_APPROACH * dt;
  sim.time += dt;

  for (i = 0; i < n; i++) {
    var radius = s.r[i];

    // Gravity with air resistance: vy relaxes toward a radius-dependent
    // terminal velocity instead of accelerating without bound.
    var terminal = GRAVITY_TERMINAL_BASE + radius * GRAVITY_TERMINAL_PER_R;
    s.vy[i] += (terminal - s.vy[i]) * FALL_APPROACH * dt;

    // Lateral drift = global wind + a per-particle sway.
    s.phase[i] += dt * (0.8 + radius * 0.2);
    var sway = Math.sin(s.phase[i]) * (SWAY_BASE + radius * SWAY_PER_R);
    s.vx[i] += (sim.windCurrent + sway - s.vx[i]) * WIND_APPROACH * dt;

    var nextX = s.x[i] + s.vx[i] * dt;
    var nextY = s.y[i] + s.vy[i] * dt;

    // Surface landing is checked before committing the new position, using the
    // flake's previous and next bottom edges. Only surfaces spanning the flake
    // are examined; no all-pairs collision loop.
    if (sim.surfaces.length > 0 && sim.collisionModule && sim.bankModule) {
      var hit = sim.collisionModule.landingSurface(
        sim.bankModule, sim.surfaces, s, i, nextX, nextY, radius, 2)
      if (hit) {
        sim.bankModule.deposit(hit.bank, nextX, sim.depositAmount, sim.depositSpread)
        sim.landings++
        sim.particles.spawn(s, i, false)
        continue
      }
    }

    s.x[i] = nextX;
    s.y[i] = nextY;
    s.rot[i] += s.vr[i] * dt;

    // Recycle a flake that left the bottom, and wrap horizontally. No heap
    // allocation: spawn() rewrites the existing typed-array slots.
    if (s.y[i] > s.height + RESPAWN_MARGIN) sim.particles.spawn(s, i, false);
    if (s.x[i] < -RESPAWN_MARGIN) s.x[i] = s.width + RESPAWN_MARGIN;
    else if (s.x[i] > s.width + RESPAWN_MARGIN) s.x[i] = -RESPAWN_MARGIN;
  }

  stepDetached(sim, dt)

  // Real accumulation buries tracks. Smooth the landing count so one flake
  // cannot cause a visible jump, and check bank stability on a slower cadence.
  var observedRate = (sim.landings - landingsBefore) / dt
  sim.snowfallRate += (observedRate - sim.snowfallRate) * Math.min(1, dt * 2)
  if (sim.avalancheCheckSeconds > 0) {
    sim.avalancheTimer += dt
    if (sim.avalancheTimer >= sim.avalancheCheckSeconds) {
      maybeAvalanche(sim, sim.avalancheTimer)
      sim.avalancheTimer = 0
    }
  }

  // The rolling ball is part of this one fixed-step loop. Pointer targets are
  // set by the builder; the eased move gathers snow through the existing brush.
  if (sim.roll && sim.rollModule && sim.rollGather) {
    var effects = sim.rollEffects
    effects.length = 0
    sim.rollModule.advance(sim.roll, dt, sim.rollGather, effects)
    processRollEffects(sim, effects)
  }
  // The plow shares this fixed step and the existing track/particle stores. It
  // decides for itself whether this monitor's ground bank needs a vehicle.
  if (sim.plowModule && sim.plowEnabled) sim.plowModule.update(sim, dt)
  if (sim.tracks && sim.tracksModule) {
    sim.tracksModule.update(sim.tracks, dt,
      sim.tracksModule.FADE_PER_SECOND, trackBuryRate(sim))
  }

  sim.stepCount++
  if (sim.bankModule && sim.stepCount % sim.settleSteps === 0) settleBanks(sim)
}

// Detached flakes inherit window momentum, then fall under gravity and land on
// whichever surface they cross first. The pool is bounded and slots are reused.
function stepDetached(sim, dt) {
  var d = sim.detachedSystem
  if (!d || !sim.particles || d.count === 0) return
  var i = 0
  while (i < d.count) {
    d.vy[i] += sim.detachedGravity * dt
    var nextX = d.x[i] + d.vx[i] * dt
    var nextY = d.y[i] + d.vy[i] * dt
    var hit = null
    if (sim.collisionModule && sim.bankModule)
      hit = sim.collisionModule.landingSurface(
        sim.bankModule, sim.surfaces, d, i, nextX, nextY, d.r[i], 2)
    if (hit) {
      // A shed chunk carries the exact area lifted from its window bank. Put
      // that same area back on whatever surface it lands on (ground or another
      // window) so snow is transported, never duplicated or lost in flight.
      // giveBack() normalises the soft mound and returns what actually fitted.
      if (d.mass[i] > 0) {
        sim.landedArea += sim.bankModule.giveBack(hit.bank, nextX, d.mass[i], sim.depositSpread)
      } else {
        sim.bankModule.deposit(hit.bank, nextX, sim.depositAmount, sim.depositSpread)
      }
      sim.landings++
      sim.bankRevision++
      sim.particles.remove(d, i)
      continue
    }
    d.x[i] = nextX
    d.y[i] = nextY
    // Tumble while falling: light flakes barely turn, medium clusters spin a
    // little and heavy chunks roll, all from the per-tier vr set at shedding.
    d.rot[i] += d.vr[i] * dt
    if (nextY > d.height + 20 || nextX < -20 || nextX > d.width + 20) {
      sim.particles.remove(d, i)
      continue
    }
    i++
  }
}

// Tracks fade on their own and are buried faster while snow is really landing.
// The smoothed landing rate keeps a brief gust from instantly erasing them.
function trackBuryRate(sim) {
  var base = sim.tracksModule ? sim.tracksModule.BURY_PER_DENSITY : 0
  var density = Math.max(0, sim.density || 0)
  var landing = Math.min(0.14, Math.max(0, sim.snowfallRate || 0)
    / Math.max(60, sim.lastLimit || 60) * 0.05)
  return base * density + landing
}

// A released ball settles on the bank below it: it creeps a little downhill,
// presses a soft impression into the snow (mass conserved by SnowBank.compact),
// and is nudged clear of other balls so it never intersects a snowman. No new
// object is created here: the builder receives plain numbers for placement.
function settleBall(sim, x, y, radius, others) {
  var result = {
    x: Number(x), y: Number(y), rolled: 0, compressed: 0,
    collision: false, surfaceId: ""
  }
  var r = Math.max(4, Math.min(70, Number(radius) || 12))
  if (!sim.bankModule || !sim.collisionModule) return result

  var hit = restingSurface(sim, result.x, result.y, r * 0.6)
  if (!hit || !hit.surface.bank) return result
  var surface = hit.surface
  var bank = surface.bank
  result.surfaceId = surface.id
  var px = result.x
  var steps = Math.max(0, Math.floor(sim.settleRollSteps))
  for (var k = 0; k < steps; k++) {
    var left = sim.bankModule.heightAt(bank, px - r)
    var right = sim.bankModule.heightAt(bank, px + r)
    var difference = right - left
    if (Math.abs(difference) < 0.4) break
    var shift = Math.max(-r * 0.35, Math.min(r * 0.35, -difference * sim.settleRollGain))
    var next = px + shift
    if (next < surface.x + r || next > surface.x + surface.width - r) break
    px = next
    result.rolled += Math.abs(shift)
  }
  result.x = px

  var compressed = sim.bankModule.compact(bank, px, r * 0.8, sim.settleCompactAmount)
  if (compressed > 0) sim.bankRevision++
  result.compressed = compressed

  var list = others || []
  for (var s = 0; s < list.length; s++) {
    var item = list[s]
    if (!item || (item.monitor && item.monitor !== sim.monitorName)) continue
    var balls = item.balls || []
    for (var b = 0; b < balls.length; b++) {
      var ball = balls[b]
      if (!ball || !(ball.r > 0)) continue
      var dx = result.x - ball.x
      var dy = result.y - ball.y
      var distance = Math.sqrt(dx * dx + dy * dy)
      var wanted = (r + ball.r) * 0.82
      if (distance >= wanted) continue
      var push = wanted - Math.max(distance, 0.01)
      result.x += (dx >= 0 ? 1 : -1) * push * 0.6
      result.y -= push * 0.2
      result.collision = true
    }
  }

  // Re-seat after any horizontal nudge so the ball cannot hang in the air or
  // sink through the surface. A small overlap with the snow reads as weight.
  if (result.x >= surface.x && result.x <= surface.x + surface.width)
    result.y = sim.bankModule.surfaceTopAt(bank, result.x) - r * sim.settleSinkFraction
  return result
}

// Rare natural avalanches. A deep peak that has been quiet long enough may
// slide downwind, smooth itself, and hand a small chunk to the existing falling
// pool. Sliding and redistribution conserve bank mass; the shed chunk's exact
// area travels with it and is deposited wherever it lands (Phase 3 behaviour).
function maybeAvalanche(sim, dt) {
  if (!sim.bankModule || !sim.detachedSystem || !(dt > 0)) return
  for (var i = 0; i < sim.surfaces.length; i++) {
    var surface = sim.surfaces[i]
    var bank = surface && surface.bank
    if (!bank || bank.segments <= 0) continue
    if (surface.avalancheCooldown > 0) {
      surface.avalancheCooldown = Math.max(0, surface.avalancheCooldown - dt)
      continue
    }
    var peak = 0
    for (var j = 0; j < bank.segments; j++)
      if (bank.heights[j] > peak) peak = bank.heights[j]
    if (peak < sim.avalancheMinDepth) continue
    if (sim.random() >= sim.avalancheChance * dt) continue

    surface.avalancheCooldown = sim.avalancheCooldown
    sim.avalancheEvents++
    var direction = sim.wind >= 0 ? 1 : -1
    var moved = sim.bankModule.slide(bank, direction, sim.avalancheSlideAmount, false)
    var smoothed = sim.bankModule.redistribute(bank, sim.avalancheSlideAmount * 0.5)

    // Ground piles can slide along the floor; a window's overhanging edge can
    // also drop a chunk, which then lands on whatever surface is below it.
    if (surface.type === "window") {
      var edge = direction > 0 ? bank.segments - 1 : 0
      if (bank.limit[edge] >= 1.5 && bank.heights[edge] > 1) {
        var units = Math.min(bank.heights[edge], sim.avalancheShedMass / bank.segmentWidth)
        var area = sim.bankModule.takeFromSegment(bank, edge, units)
        if (area > 0) {
          // Spawn just outside the overhang. Dropping on top of the last segment
          // would land straight back on the same bank instead of falling free.
          var x = direction > 0 ? bank.x + bank.width + 4 : bank.x - 4
          var y = bank.y - bank.heights[edge] - 3
          var idx = sim.particles.inject(sim.detachedSystem, x, y,
            direction * 18, -6, 2.2, 0.6, 1, 1, area)
          if (idx >= 0) {
            sim.detachedSystem.vr[idx] = (sim.random() < 0.5 ? -1 : 1) * 40
            sim.avalancheArea += area
            sim.detachedArea += area
          } else {
            // Bounded pool is full: put the snow back rather than lose it.
            sim.bankModule.giveBack(bank, x, area, 4)
          }
        }
      }
    }
    if (moved || smoothed) sim.bankRevision++
  }
}

// Slow, deterministic bank settling: downwind slide, peak redistribution and a
// very small melt. A wind of zero still redistributes but does not slide.
function settleBanks(sim) {
  var changed = false
  var direction = sim.wind >= 0 ? 1 : -1
  var strength = Math.min(1, Math.abs(sim.wind))
  for (var i = 0; i < sim.surfaces.length; i++) {
    var bank = sim.surfaces[i].bank
    if (!bank) continue
    if (strength > 0 && sim.bankModule.slide(bank, direction, sim.slideAmount * strength, true)) changed = true
    if (sim.bankModule.redistribute(bank, sim.redistributeAmount)) changed = true
    if (sim.bankModule.erode(bank, sim.erodeAmount)) changed = true
  }
  if (changed) sim.bankRevision++
}

function recordWindow(sim) {
  var m = sim.metrics;
  if (m.windowSeconds >= 2 && m.steps > 0) {
    m.avgStepMs = m.stepMs / m.steps;
    m.stepsPerSecond = m.steps / m.windowSeconds;
    m.avgPaintMs = m.paints > 0 ? m.paintMs / m.paints : 0;
    m.paintsPerSecond = m.paints / m.windowSeconds;
    m.windowSeconds = 0;
    m.steps = 0;
    m.stepMs = 0;
    m.paints = 0;
    m.paintMs = 0;
  }
}

// Advance by real elapsed time using bounded fixed steps.
function update(sim, elapsedSeconds) {
  if (sim.paused) return 0;
  var elapsed = elapsedSeconds;
  if (!isFinite(elapsed) || elapsed < 0) return 0;
  if (elapsed > sim.maxBacklogSeconds) elapsed = sim.maxBacklogSeconds;
  // Frame drift is a proxy for compositor cost: JS timing alone misses the
  // time Qt spends rasterising two full-screen canvases each frame.
  var m = sim.metrics
  m.frameSamples++
  m.frameMsSum += elapsed * 1000
  m.frameDriftSum += Math.max(0, elapsed * 1000 - sim.frameIntervalMs)
  if (m.frameSamples >= 120) {
    m.frameMs = m.frameMsSum / m.frameSamples
    m.frameDriftMs = m.frameDriftSum / m.frameSamples
    m.frameSamples = 0
    m.frameMsSum = 0
    m.frameDriftSum = 0
  }
  sim.accumulator += elapsed;

  var maxSteps = sim.maxStepsPerFrame;
  var steps = 0;
  var started = now();
  while (sim.accumulator >= sim.stepSeconds && steps < maxSteps) {
    step(sim, sim.stepSeconds);
    sim.accumulator -= sim.stepSeconds;
    steps++;
  }
  // If we hit the per-frame ceiling, discard the remaining backlog instead of
  // spreading a long interruption across many later frames.
  if (steps >= maxSteps) sim.accumulator = 0;
  var spent = now() - started;

  sim.metrics.windowSeconds += elapsed;
  sim.metrics.steps += steps;
  sim.metrics.stepMs += spent;
  recordWindow(sim);
  return steps;
}

// Renderers report their paint time here so diagnostics can show both halves
// of the frame cost without a profiler attached.
function recordPaint(sim, milliseconds) {
  if (!isFinite(milliseconds) || milliseconds < 0) return;
  sim.metrics.paints += 1;
  sim.metrics.paintMs += milliseconds;
}

// Called when the surface is unmapped: a frozen "60 paints/s" reading would be
// misleading, so diagnostics fall back to zero until the next active window.
function resetMetrics(sim) {
  var m = sim.metrics;
  m.windowSeconds = 0;
  m.steps = 0;
  m.stepMs = 0;
  m.paints = 0;
  m.paintMs = 0;
  m.avgStepMs = 0;
  m.avgPaintMs = 0;
  m.stepsPerSecond = 0;
  m.paintsPerSecond = 0;
  m.frameMs = 0;
  m.frameDriftMs = 0;
  m.frameSamples = 0;
  m.frameMsSum = 0;
  m.frameDriftSum = 0;
}

function metrics(sim) {
  var m = sim.metrics;
  return {
    particles: sim.system.count,
    limit: sim.lastLimit,
    quality: sim.quality,
    density: sim.density,
    wind: sim.wind,
    paused: sim.paused,
    adaptiveScale: sim.adaptiveScale,
    steps: m.steps,
    paints: m.paints,
    surfaces: sim.surfaces.length,
    bankRevision: sim.bankRevision,
    landings: sim.landings,
    detached: sim.detachedSystem ? sim.detachedSystem.count : 0,
    detachments: sim.detachments,
    rolling: sim.roll !== null,
    tracks: sim.tracks ? sim.tracks.count : 0,
    avgStepMs: Math.round(m.avgStepMs * 100) / 100,
    avgPaintMs: Math.round(m.avgPaintMs * 100) / 100,
    stepsPerSecond: Math.round(m.stepsPerSecond),
    paintsPerSecond: Math.round(m.paintsPerSecond),
    frameMs: Math.round(m.frameMs * 100) / 100,
    frameDriftMs: Math.round(m.frameDriftMs * 100) / 100
  };
}

function now() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function")
    return performance.now();
  return Date.now();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GRAVITY_TERMINAL_BASE: GRAVITY_TERMINAL_BASE,
    GRAVITY_TERMINAL_PER_R: GRAVITY_TERMINAL_PER_R,
    create: create,
    step: step,
    update: update,
    setDensity: setDensity,
    setWind: setWind,
    setQuality: setQuality,
    setGeometry: setGeometry,
    setAccumulateOnWindows: setAccumulateOnWindows,
    setPlowEnabled: setPlowEnabled,
    setSnowmen: setSnowmen,
    settleBall: settleBall,
    maybeAvalanche: maybeAvalanche,
    trackBuryRate: trackBuryRate,
    applyWindowMovement: applyWindowMovement,
    stepDetached: stepDetached,
    gather: gather,
    restingSurface: restingSurface,
    returnSnow: returnSnow,
    beginRoll: beginRoll,
    setRollTarget: setRollTarget,
    rollState: rollState,
    takeRoll: takeRoll,
    finishRoll: finishRoll,
    setPaused: setPaused,
    setAdaptiveScale: setAdaptiveScale,
    clearBanks: clearBanks,
    resize: resize,
    reset: reset,
    recordPaint: recordPaint,
    resetMetrics: resetMetrics,
    metrics: metrics,
    now: now
  };
}
