// Snow-eating bulldozer model.
//
// Pure JavaScript: no Qt, no rendering, no Hyprland. One optional vehicle per
// monitor, owned by the simulation and advanced by the same fixed step as the
// snowfall and the roller. QML cannot import JS modules, so this file is
// injected through Simulation.create(), exactly like SnowRoll and SnowTracks.
//
// The plow lifts snow with the existing SnowBank.scoop() brush, so the bank
// visibly shrinks by the exact area carried in its scoop. It never deposits
// that snow back: unloading happens off-screen, which is what makes it a snow
// *removal* vehicle rather than a snow mover. Cosmetic scoop dust is injected
// into the existing detached pool with settle=0 and mass=0, so it cannot add
// bank mass or duplicate the load.

var EDGE_OFFSET = 26;          // vehicle half-width plus a little margin
var MIN_SNOW = 0.6;            // ignore traces below this depth when targeting

function groundSurface(sim) {
  var surfaces = sim.surfaces || []
  for (var i = 0; i < surfaces.length; i++) {
    if (surfaces[i] && surfaces[i].type === "ground") return surfaces[i]
  }
  return null
}

function averageDepth(bank) {
  if (!bank || bank.segments <= 0) return 0
  return sim_bankTotal(bank) / bank.segments
}

function sim_bankTotal(bank) {
  var total = 0
  for (var i = 0; i < bank.segments; i++) total += bank.heights[i]
  return total
}

// Snowmen live in the service; the simulation keeps only the plain records for
// this monitor. Their bottom balls define a protected span so the scoop cannot
// eat the snow a user deliberately built a snowman on.
function protectedSpans(sim, bank) {
  var spans = []
  var list = sim.snowmen || []
  for (var s = 0; s < list.length; s++) {
    var item = list[s]
    if (!item || item.monitor !== sim.monitorName) continue
    var balls = item.balls || []
    for (var b = 0; b < balls.length; b++) {
      var ball = balls[b]
      if (!ball || !(ball.r > 0)) continue
      var reach = ball.r + (sim.plowSnowmanMargin || 20)
      spans.push([ball.x - reach, ball.x + reach])
    }
  }
  return spans
}

function isProtected(spans, x) {
  for (var i = 0; i < spans.length; i++) {
    if (x >= spans[i][0] && x <= spans[i][1]) return true
  }
  return false
}

// A target is only useful if the plow can reach it without driving over a
// snowman's base on the way. This keeps it on one side instead of stalling
// against a protected span while chasing a pile behind it.
function pathClear(spans, fromX, toX) {
  var lo = Math.min(fromX, toX)
  var hi = Math.max(fromX, toX)
  for (var i = 0; i < spans.length; i++) {
    if (spans[i][1] >= lo && spans[i][0] <= hi) return false
  }
  return true
}

function hasSnowNear(bank, x) {
  if (!bank) return false
  var centre = bankModuleIndex(bank, x)
  for (var i = centre - 2; i <= centre + 2; i++) {
    if (i < 0 || i >= bank.segments) continue
    if (bank.limit[i] > 0 && bank.heights[i] > MIN_SNOW) return true
  }
  return false
}

function bankModuleIndex(bank, x) {
  var i = Math.floor((x - bank.x) / bank.segmentWidth)
  if (i < 0) return 0
  if (i >= bank.segments) return bank.segments - 1
  return i
}

// Deepest reachable segment wins; distance breaks ties so a uniform bank still
// gives an advancing target instead of dithering over one spot. `ignorePath`
// is used for the initial spawn decision, where fromX is only a nominal screen
// centre (which may itself sit inside a snowman's protected span). Once the
// vehicle is on screen, pathClear() keeps it from driving through a snowman.
function pickTarget(sim, bank, spans, fromX, ignorePath) {
  if (!bank) return null
  var bestX = null
  var bestHeight = 0
  var bestDistance = -1
  for (var i = 0; i < bank.segments; i++) {
    if (bank.limit[i] <= 0 || bank.heights[i] <= MIN_SNOW) continue
    var x = bank.x + (i + 0.5) * bank.segmentWidth
    if (isProtected(spans, x)) continue
    if (!ignorePath && !pathClear(spans, fromX, x)) continue
    var distance = Math.abs(x - fromX)
    if (bank.heights[i] > bestHeight + 0.001
        || (Math.abs(bank.heights[i] - bestHeight) <= 0.001 && distance > bestDistance)) {
      bestHeight = bank.heights[i]
      bestDistance = distance
      bestX = x
    }
  }
  return bestX
}

function spawn(sim, bank, spans, targetX) {
  var width = sim.system ? sim.system.width : 1920
  var fromLeft = targetX >= width / 2
  var p = {
    state: "entering",
    x: fromLeft ? -EDGE_OFFSET : width + EDGE_OFFSET,
    y: bank.y,
    dir: fromLeft ? 1 : -1,
    targetX: targetX,
    speed: sim.plowSpeed,
    capacity: sim.plowCapacity,
    load: 0,
    travel: 0,
    scoopPhase: 0,
    bounce: 0,
    frontPile: 0,
    dustTimer: 0,
    unloadTimer: 0,
    lastTrackX: -9999
  }
  sim.plow = p
  sim.plowSpawns++
  return p
}

function despawn(sim) {
  if (!sim.plow) return
  sim.plow = null
  sim.plowCooldown = sim.plowCooldownSeconds
}

function startHauling(sim, p) {
  var width = sim.system ? sim.system.width : 1920
  p.dir = p.x < width / 2 ? -1 : 1
  p.state = "hauling"
  p.dustTimer = 0
}

function speedNow(sim, p) {
  var fill = p.capacity > 0 ? Math.min(1, p.load / p.capacity) : 0
  var factor = 1 - (1 - sim.plowLoadedSpeedFactor) * fill
  return p.speed * Math.max(0.2, factor)
}

function moveTowards(p, x, distance) {
  var delta = x - p.x
  if (Math.abs(delta) <= distance) { p.x = x; return true }
  p.x += (delta > 0 ? distance : -distance)
  return false
}

// Advance the one vehicle. Spawning, targeted movement, collection, carrying,
// unloading and idling are all decided here from bank state; the renderer only
// reads the resulting plain fields on the scene's existing frame notification.
function update(sim, dt) {
  if (!(dt > 0) || !sim.bankModule) return
  if (sim.plowCooldown > 0) sim.plowCooldown = Math.max(0, sim.plowCooldown - dt)

  var surface = groundSurface(sim)
  if (!surface || !surface.bank) { despawn(sim); return }
  var bank = surface.bank
  var avg = averageDepth(bank)
  var spans = protectedSpans(sim, bank)
  var width = sim.system ? sim.system.width : 1920

  if (!sim.plow) {
    if (sim.plowEnabled === false || sim.plowCooldown > 0 || avg < sim.plowSpawnDepth) return
    var newTarget = pickTarget(sim, bank, spans, width / 2, true)
    if (newTarget === null) return
    spawn(sim, bank, spans, newTarget)
    return
  }

  var p = sim.plow
  p.scoopPhase += dt * (p.state === "collecting" ? 7 : 2.4)
  p.frontPile = Math.max(0, p.frontPile - dt * 0.5)
  var step = speedNow(sim, p) * dt

  // Parked just off-screen between the two thresholds. This is the hysteresis:
  // it does not re-enter until the floor is clearly covered again, and it does
  // not disappear for good until the snow is clearly gone.
  if (p.state === "idle") {
    if (avg >= sim.plowSpawnDepth) {
      var resume = pickTarget(sim, bank, spans, width / 2, true)
      if (resume !== null) { spawn(sim, bank, spans, resume); return }
    }
    if (avg <= sim.plowDespawnDepth) despawn(sim)
    return
  }

  if (p.state === "unloading") {
    p.unloadTimer += dt
    if (p.unloadTimer < sim.plowUnloadSeconds) return
    // The load leaves the desktop entirely; nothing is put back on a bank.
    sim.plowUnloaded += p.load
    p.load = 0
    avg = averageDepth(bank)
    if (avg >= sim.plowSpawnDepth) {
      var again = pickTarget(sim, bank, spans, width / 2, true)
      if (again !== null) { spawn(sim, bank, spans, again); return }
    }
    p.state = "idle"
    return
  }

  if (p.state === "hauling") {
    var edge = p.dir > 0 ? width + EDGE_OFFSET : -EDGE_OFFSET
    var before = p.x
    var arrived = moveTowards(p, edge, step)
    p.travel += Math.abs(p.x - before)
    stampTrack(sim, p, bank)
    if (arrived) { p.state = "unloading"; p.unloadTimer = 0 }
    return
  }

  // Entering or collecting.
  if (p.load >= p.capacity) { startHauling(sim, p); return }
  if (p.targetX === null || !hasSnowNear(bank, p.targetX)
      || isProtected(spans, p.targetX)
      || !pathClear(spans, p.x, p.targetX)) {
    var next = pickTarget(sim, bank, spans, p.x)
    if (next === null) {
      // Leave the desktop visibly rather than blinking out in place; the
      // idle/despawn decision happens once it is off-screen.
      startHauling(sim, p)
      return
    }
    p.targetX = next
  }

  var delta = p.targetX - p.x
  if (Math.abs(delta) < 2) p.targetX = null
  var nextX = p.targetX === null ? p.x : p.x + (delta > 0 ? Math.min(delta, step) : Math.max(delta, -step))
  // Never drive over a snowman's base. A clear path was chosen above; this is
  // the last line of defence if the layout changed while the plow was moving.
  if (isProtected(spans, nextX) || !pathClear(spans, p.x, nextX)) {
    p.targetX = null
    return
  }
  var moved = nextX - p.x
  p.x = nextX
  if (moved !== 0) p.dir = moved > 0 ? 1 : -1
  p.travel += Math.abs(moved)

  if (p.state === "entering" && p.x >= 0 && p.x <= width) p.state = "collecting"
  stampTrack(sim, p, bank)

  // A little suspension movement from the profile under and just ahead of the
  // treads; deterministic, driven by travel rather than a timer.
  var here = sim.bankModule.heightAt(bank, p.x)
  var ahead = sim.bankModule.heightAt(bank, p.x + p.dir * 12)
  p.bounce = Math.sin(p.travel * 0.12) * 0.8
    + Math.max(-2, Math.min(2, (ahead - here) * 0.25))

  if (p.state !== "collecting") return

  var room = p.capacity - p.load
  if (room > 0) {
    var got = sim.bankModule.scoop(bank, p.x, bank.y - 2,
      sim.plowScoopRadius, sim.plowScoopAmount, room)
    if (got > 0) {
      p.load += got
      sim.plowCollected += got
      p.frontPile = Math.min(1, p.frontPile + got * 0.004)
    }
  }

  // Decorative snow nudged toward the scoop. It lives in the detached pool but
  // carries no mass and never settles, so it cannot re-deposit the load.
  if (hasSnowNear(bank, p.x + p.dir * sim.plowScoopRadius)
      && sim.particles && sim.detachedSystem) {
    p.dustTimer += dt
    if (p.dustTimer >= sim.plowDustEvery) {
      p.dustTimer = 0
      sim.particles.inject(sim.detachedSystem,
        p.x + p.dir * (sim.plowScoopRadius + 3),
        bank.y - 3 - sim.random() * 3,
        -p.dir * (26 + sim.random() * 24),
        -8 - sim.random() * 10,
        0.7 + sim.random() * 0.7,
        0.45, 1, 0, 0)
    }
  } else {
    p.dustTimer = 0
  }
}

function stampTrack(sim, p, bank) {
  if (p.state === "entering" || !sim.tracks || !sim.tracksModule) return
  if (Math.abs(p.x - p.lastTrackX) < 6) return
  p.lastTrackX = p.x
  sim.tracksModule.stamp(sim.tracks, p.x - p.dir * 6, bank.y - 2,
    sim.plowTrackRadius, sim.plowTrackStrength)
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EDGE_OFFSET: EDGE_OFFSET,
    averageDepth: averageDepth,
    protectedSpans: protectedSpans,
    isProtected: isProtected,
    pathClear: pathClear,
    pickTarget: pickTarget,
    update: update
  };
}
