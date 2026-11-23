.pragma library

// Flurry weather simulation.
//
// Pure JavaScript with no QML types, so the whole thing runs (and is tested)
// under node as well as inside the shell. One world per screen, in that
// screen's logical pixels. The QML side feeds it window rectangles and the
// pointer, steps it once per frame, and hands it to draw.js.
//
// Surfaces are the exposed top edges things land on: every window on the
// screen's active workspace plus the ground along the bottom of the screen.
// Snow piles up on them as a height field (one bin per CELL px); leaves and
// petals rest on them as particles. When a surface moves, what sits on it is
// thrown off with the window's velocity; when it closes, it all falls.

var CELL = 4
var GRAVITY = 900
var GROUND_ID = "__ground"

var EFFECTS = ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]

// Per-effect tuning. Rates are spawns per second per 1000 px of screen width
// at intensity 1; the population of fireflies is per 1000 px.
var TUNING = {
  snow:      { rate: 42,  cap: 14, groundCap: 26 },
  leaves:    { rate: 1.4, restCap: 140 },
  starfall:  { rate: 0.32 },
  rain:      { rate: 170 },
  sakura:    { rate: 3.2, restMin: 20, restMax: 40 },
  fireflies: { population: 12 }
}

function rand(a, b) { return a + Math.random() * (b - a) }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
function pick(list) { return list[Math.floor(Math.random() * list.length)] }

function isEffect(name) { return EFFECTS.indexOf(String(name)) >= 0 }

function createWorld(width, height, opts) {
  opts = opts || {}
  var world = {
    width: Math.max(1, width | 0),
    height: Math.max(1, height | 0),
    groundInset: opts.groundInset || 0,
    effect: isEffect(opts.effect) ? opts.effect : "snow",
    intensity: clamp(opts.intensity === undefined ? 1 : +opts.intensity, 0.25, 2),
    quality: 1,
    running: true,
    time: 0,
    particles: [],
    surfaces: {},
    order: [],
    spawnDebt: 0,
    wind: 0,
    windTarget: 0,
    windTimer: 0,
    flash: 0,
    bolt: null,
    nextLightning: rand(10, 30),
    pendingFlash: -1,
    lastSurfaceTime: -1
  }
  world.surfaces[GROUND_ID] = makeSurface(GROUND_ID, 0, groundY(world), world.width, true)
  return world
}

function groundY(world) { return world.height - world.groundInset }

function makeSurface(id, x, y, w, ground) {
  var n = Math.max(1, Math.ceil(w / CELL))
  var bins = new Array(n)
  for (var i = 0; i < n; i++) bins[i] = 0
  return {
    id: id, x: x, y: y, w: w, h: 0,
    ground: !!ground, floating: false, z: ground ? 1e9 : 0,
    bins: bins, front: [], seen: true
  }
}

function resize(world, width, height, groundInset) {
  world.width = Math.max(1, width | 0)
  world.height = Math.max(1, height | 0)
  if (groundInset !== undefined) world.groundInset = groundInset
  var g = world.surfaces[GROUND_ID]
  var fresh = makeSurface(GROUND_ID, 0, groundY(world), world.width, true)
  for (var i = 0; i < Math.min(g.bins.length, fresh.bins.length); i++) fresh.bins[i] = g.bins[i]
  world.surfaces[GROUND_ID] = fresh
  rebuildOrder(world)
}

function setEffect(world, name) {
  if (!isEffect(name) || world.effect === name) return
  world.effect = name
  world.spawnDebt = 0
  // Falling things of the old effect keep falling; things that only make
  // sense inside one effect go now.
  world.particles = world.particles.filter(function(p) {
    return p.kind !== "firefly" && p.kind !== "meteor" && p.kind !== "drop"
  })
  world.flash = 0
  world.bolt = null
}

function setIntensity(world, v) { world.intensity = clamp(+v || 1, 0.25, 2) }

// ------------------------------------------------------------------ surfaces

// rects: [{ id, x, y, w, h, floating, z }] in screen-local px, z lower = in
// front (Hyprland's focusHistoryID). now: seconds, any monotonic clock.
function setSurfaces(world, rects, now) {
  var dtSince = world.lastSurfaceTime < 0 ? 0 : Math.max(0.016, now - world.lastSurfaceTime)
  world.lastSurfaceTime = now
  var seen = {}
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i]
    if (!r || !r.id || r.w < 8 || r.h < 8) continue
    var id = String(r.id)
    seen[id] = true
    var s = world.surfaces[id]
    if (!s) {
      s = makeSurface(id, r.x, r.y, r.w, false)
      world.surfaces[id] = s
    } else {
      var dx = r.x - s.x, dy = r.y - s.y
      var resized = Math.abs(r.w - s.w) > 0.5
      if (resized && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        resizeSurface(world, s, r.w)
      } else if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
        var vx = dtSince > 0 ? dx / dtSince : 0
        var vy = dtSince > 0 ? dy / dtSince : 0
        shed(world, s, vx, vy, Math.hypot(dx, dy))
        if (resized) resizeSurface(world, s, r.w)
      }
    }
    s.x = r.x; s.y = r.y; s.w = r.w; s.h = r.h
    s.floating = !!r.floating
    s.z = r.z === undefined ? 0 : r.z
  }
  var ids = Object.keys(world.surfaces)
  for (var j = 0; j < ids.length; j++) {
    var sid = ids[j]
    if (sid === GROUND_ID || seen[sid]) continue
    spill(world, world.surfaces[sid], 0, 0)
    delete world.surfaces[sid]
  }
  rebuildOrder(world)
}

function rebuildOrder(world) {
  var list = []
  for (var id in world.surfaces) list.push(world.surfaces[id])
  list.sort(function(a, b) { return inFront(a, b) ? -1 : (inFront(b, a) ? 1 : 0) })
  world.order = list
  for (var i = 0; i < list.length; i++) {
    var s = list[i]
    s.front = []
    if (s.ground) continue
    for (var k = 0; k < list.length; k++) {
      var o = list[k]
      if (o === s || o.ground) continue
      if (inFront(o, s) && overlaps(o, s)) s.front.push(o)
    }
  }
}

// Floating windows sit above tiled ones; within a layer the most recently
// focused is on top. The ground is behind everything.
function inFront(a, b) {
  if (a.ground !== b.ground) return b.ground
  if (a.floating !== b.floating) return a.floating
  return a.z < b.z
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + Math.max(b.h, 1) && b.y < a.y + Math.max(a.h, 1)
}

function covered(s, x, y) {
  for (var i = 0; i < s.front.length; i++) {
    var o = s.front[i]
    if (x >= o.x && x <= o.x + o.w && y >= o.y - 1 && y <= o.y + o.h) return true
  }
  return false
}

function resizeSurface(world, s, w) {
  var n = Math.max(1, Math.ceil(w / CELL))
  if (n < s.bins.length) {
    // The cut-off end falls.
    for (var i = n; i < s.bins.length; i++) dropHeap(world, s, i, 0, 0)
    s.bins.length = n
  } else {
    for (var j = s.bins.length; j < n; j++) s.bins.push(0)
  }
  for (var k = 0; k < world.particles.length; k++) {
    var p = world.particles[k]
    if (p.rest === s.id && p.ox > w) release(p, s, 0, 0)
  }
}

// A moving window throws off what sits on it. A nudge sheds a little; a
// fling clears it.
function shed(world, s, vx, vy, distance) {
  var speed = Math.hypot(vx, vy)
  var fraction = clamp(distance / 40 + speed / 900, 0.15, 1)
  for (var i = 0; i < s.bins.length; i++) {
    var take = s.bins[i] * fraction
    if (take < 0.05) continue
    s.bins[i] -= take
    spawnClumps(world, s.x + (i + 0.5) * CELL, s.y - s.bins[i] - take * 0.5, take, -vx * 0.55, -vy * 0.35 - 40)
  }
  for (var k = 0; k < world.particles.length; k++) {
    var p = world.particles[k]
    if (p.rest === s.id) release(p, s, -vx * 0.5, -vy * 0.3 - 60)
  }
}

// A closing window drops everything on it straight down.
function spill(world, s, vx, vy) {
  for (var i = 0; i < s.bins.length; i++) dropHeap(world, s, i, vx, vy)
  for (var k = 0; k < world.particles.length; k++) {
    var p = world.particles[k]
    if (p.rest === s.id) release(p, s, vx, vy)
  }
}

function dropHeap(world, s, i, vx, vy) {
  var h = s.bins[i]
  if (h < 0.05) return
  s.bins[i] = 0
  spawnClumps(world, s.x + (i + 0.5) * CELL, s.y - h * 0.5, h, vx, vy)
}

function spawnClumps(world, x, y, amount, vx, vy) {
  // One clump carries up to ~2 px of heap, so a full window becomes a few
  // hundred clumps rather than thousands.
  var count = Math.max(1, Math.min(4, Math.round(amount / 2)))
  for (var c = 0; c < count; c++) {
    if (world.particles.length > maxParticles(world) * 1.3) return
    world.particles.push({
      kind: "clump",
      x: x + rand(-CELL, CELL), y: y + rand(-2, 1),
      vx: vx + rand(-50, 50), vy: vy + rand(-40, 10),
      r: clamp(1.2 + amount / count * 0.9, 1.2, 3.6),
      amount: amount / count,
      life: 6, age: 0, rest: null
    })
  }
}

function release(p, s, vx, vy) {
  p.rest = null
  p.x = s.x + p.ox
  p.y = s.y - 2
  p.vx = vx + rand(-40, 40)
  p.vy = vy + rand(-30, 0)
  p.spin = rand(-6, 6)
}

function heightAt(s, x) {
  var i = Math.floor((x - s.x) / CELL)
  if (i < 0 || i >= s.bins.length) return 0
  return s.bins[i]
}

// Where a particle moving from (x0,y0) to (x1,y1) first meets an exposed top.
function collide(world, x0, y0, x1, y1) {
  if (y1 <= y0) return null
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    if (!s.ground && (x1 < s.x || x1 > s.x + s.w)) continue
    var top = s.y - heightAt(s, x1)
    if (y0 <= top + 0.5 && y1 >= top) {
      if (!s.ground && covered(s, x1, s.y)) continue
      return { surface: s, y: top }
    }
  }
  return null
}

function deposit(world, s, x, amount) {
  var i = Math.floor((x - s.x) / CELL)
  if (i < 0 || i >= s.bins.length) return
  var cap = s.ground ? TUNING.snow.groundCap : TUNING.snow.cap
  s.bins[i] += amount
  if (s.bins[i] > cap) {
    var extra = s.bins[i] - cap
    s.bins[i] = cap
    // Overflow slides to the neighbour that has room, or off the end.
    var j = (i > 0 && (i === s.bins.length - 1 || s.bins[i - 1] < s.bins[i + 1])) ? i - 1 : i + 1
    if (j >= 0 && j < s.bins.length && s.bins[j] < cap) s.bins[j] += extra
    else if (!s.ground) spawnClumps(world, s.x + (j < i ? 0 : s.w), s.y - cap, extra, j < i ? -30 : 30, 0)
  }
}

// Angle of repose: heaps slump into their neighbours, and the ends of a
// window's pile slowly lose snow over the edge.
function settle(world, s, dt) {
  var b = s.bins
  var k = Math.min(1, dt * 6)
  for (var i = 0; i < b.length - 1; i++) {
    var d = b[i] - b[i + 1]
    if (Math.abs(d) > 1.6) {
      var m = d * 0.22 * k
      b[i] -= m
      b[i + 1] += m
    }
  }
  if (!s.ground && b.length > 2) {
    var edges = [0, b.length - 1]
    for (var e = 0; e < edges.length; e++) {
      var idx = edges[e]
      if (b[idx] > 2.5 && Math.random() < dt * 0.6) {
        var lost = Math.min(b[idx] - 1.5, rand(0.6, 1.6))
        b[idx] -= lost
        spawnClumps(world, s.x + (idx === 0 ? -1 : s.w + 1), s.y - b[idx], lost, idx === 0 ? -15 : 15, 0)
      }
    }
  }
}

function melt(s, dt, seconds) {
  var f = Math.exp(-dt / seconds)
  for (var i = 0; i < s.bins.length; i++) {
    s.bins[i] *= f
    if (s.bins[i] < 0.02) s.bins[i] = 0
  }
}

function totalSnow(world) {
  var sum = 0
  for (var id in world.surfaces) {
    var b = world.surfaces[id].bins
    for (var i = 0; i < b.length; i++) sum += b[i]
  }
  return sum
}

// ------------------------------------------------------------------ spawning

function maxParticles(world) { return Math.round(1100 * world.quality) }

function spawn(world, dt) {
  var t = TUNING[world.effect]
  if (world.effect === "fireflies") {
    var want = Math.round(t.population * world.width / 1000 * world.intensity * world.quality)
    var have = 0
    for (var i = 0; i < world.particles.length; i++) if (world.particles[i].kind === "firefly") have++
    for (; have < want; have++) world.particles.push(makeFirefly(world))
    return
  }
  world.spawnDebt += t.rate * world.width / 1000 * world.intensity * world.quality * dt
  var cap = maxParticles(world)
  while (world.spawnDebt >= 1) {
    world.spawnDebt -= 1
    if (world.particles.length >= cap) { world.spawnDebt = 0; break }
    world.particles.push(makeParticle(world))
  }
}

function makeParticle(world) {
  var x = rand(-40, world.width + 40)
  switch (world.effect) {
  case "snow":
    var depth = Math.random()
    return { kind: "flake", x: x, y: rand(-20, -4), vx: 0, vy: 26 + depth * 46,
             r: 1 + depth * 2.4, depth: depth, phase: rand(0, 6.28), sway: rand(8, 26),
             life: 120, age: 0, rest: null }
  case "leaves":
    return { kind: "leaf", x: x, y: -16, vx: rand(-20, 20), vy: rand(40, 70), r: rand(6, 10),
             angle: rand(0, 6.28), spin: rand(-2.5, 2.5), phase: rand(0, 6.28), sway: rand(30, 60),
             hue: Math.floor(rand(0, 4)), life: 600, age: 0, rest: null }
  case "sakura":
    return { kind: "petal", x: x, y: -10, vx: rand(10, 35), vy: rand(22, 40), r: rand(3.5, 6),
             angle: rand(0, 6.28), spin: rand(-3, 3), phase: rand(0, 6.28), sway: rand(16, 34),
             hue: Math.floor(rand(0, 3)), life: 600, age: 0, rest: null, restLeft: 0 }
  case "rain":
    return { kind: "drop", x: rand(-80, world.width + 80), y: rand(-60, -10), vx: world.wind,
             vy: rand(1000, 1350), len: rand(12, 22), life: 4, age: 0, rest: null }
  case "starfall":
    var dir = Math.random() < 0.5 ? -1 : 1
    var a = rand(0.35, 0.6)
    var sp = rand(620, 900)
    return { kind: "meteor", x: rand(world.width * 0.1, world.width * 0.9), y: -20,
             vx: dir * Math.sin(a) * sp, vy: Math.cos(a) * sp, len: rand(60, 110),
             life: 5, age: 0, rest: null }
  }
  return null
}

function makeFirefly(world) {
  return { kind: "firefly", x: rand(0, world.width), y: rand(world.height * 0.25, world.height),
           vx: rand(-20, 20), vy: rand(-20, 20), r: rand(1.6, 2.8), phase: rand(0, 6.28),
           blink: rand(0.6, 1.4), heading: rand(0, 6.28), orbit: rand(26, 80),
           orbitSpeed: rand(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1),
           life: 1e9, age: 0, rest: null }
}

function burst(world, x, y, count, palette) {
  for (var i = 0; i < count; i++) {
    var a = rand(Math.PI * 1.05, Math.PI * 1.95)
    var sp = rand(80, 280)
    world.particles.push({ kind: "spark", x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                           r: rand(0.8, 1.8), life: rand(0.5, 1.1), age: 0, rest: null,
                           hue: palette ? pick(palette) : 0 })
  }
}

function splash(world, x, y) {
  var n = Math.floor(rand(2, 4))
  for (var i = 0; i < n; i++) {
    world.particles.push({ kind: "splash", x: x, y: y - 1, vx: rand(-130, 130), vy: rand(-260, -110),
                           r: rand(0.7, 1.3), life: rand(0.25, 0.4), age: 0, rest: null })
  }
  world.particles.push({ kind: "ripple", x: x, y: y, life: 0.3, age: 0, rest: null, w: rand(6, 12) })
}

// ------------------------------------------------------------------ stepping

// input: { pointer: {x, y, vx, vy, present, stillFor} }
function step(world, dt, input) {
  if (!world.running) return
  dt = clamp(dt, 0, 0.05)
  world.time += dt
  input = input || {}
  var pointer = input.pointer && input.pointer.present ? input.pointer : null

  // Wind drifts slowly between gusts.
  world.windTimer -= dt
  if (world.windTimer <= 0) {
    world.windTimer = rand(4, 10)
    world.windTarget = world.effect === "rain" ? rand(-140, 140) : rand(-28, 28)
  }
  world.wind += (world.windTarget - world.wind) * Math.min(1, dt * 0.5)

  spawn(world, dt)
  if (world.effect === "rain") lightning(world, dt)
  else { world.flash = Math.max(0, world.flash - dt * 4); world.bolt = null }

  for (var id in world.surfaces) {
    var s = world.surfaces[id]
    settle(world, s, dt)
    if (world.effect !== "snow") melt(s, dt, 25)
    else if (s.ground) melt(s, dt, 900)
  }

  var keep = []
  var list = world.particles
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    p.age += dt
    if (p.age >= p.life) continue
    if (stepParticle(world, p, dt, pointer)) keep.push(p)
  }
  world.particles = keep
  capResting(world)
}

function lightning(world, dt) {
  world.flash = Math.max(0, world.flash - dt * 3.2)
  if (world.bolt) {
    world.bolt.age += dt
    if (world.bolt.age > 0.22) world.bolt = null
  }
  if (world.pendingFlash >= 0) {
    world.pendingFlash -= dt
    if (world.pendingFlash < 0) { world.flash = 0.55; world.pendingFlash = -1 }
  }
  world.nextLightning -= dt * world.intensity
  if (world.nextLightning <= 0) {
    world.nextLightning = rand(14, 40)
    world.flash = 0.8
    if (Math.random() < 0.6) world.pendingFlash = rand(0.09, 0.16)
    world.bolt = makeBolt(world)
  }
}

function makeBolt(world) {
  var x = rand(world.width * 0.15, world.width * 0.85)
  var target = groundY(world)
  var hits = world.order.filter(function(s) { return !s.ground && x >= s.x && x <= s.x + s.w })
  if (hits.length) target = hits[0].y
  var pts = [[x, 0]]
  var y = 0
  while (y < target) {
    y = Math.min(target, y + rand(20, 60))
    x += rand(-28, 28)
    pts.push([x, y])
  }
  return { points: pts, age: 0 }
}

function stepParticle(world, p, dt, pointer) {
  if (p.rest !== null && p.rest !== undefined) return stepResting(world, p, dt, pointer)
  var x0 = p.x, y0 = p.y
  switch (p.kind) {
  case "flake":
    p.phase += dt * (0.8 + p.depth)
    p.x += (Math.sin(p.phase) * p.sway * 0.6 + world.wind * (0.4 + p.depth)) * dt
    p.y += p.vy * dt
    break
  case "leaf":
  case "petal":
    p.phase += dt * (p.kind === "leaf" ? 1.6 : 2.2)
    p.angle += p.spin * dt
    p.vx += (world.wind * 0.8 - p.vx) * Math.min(1, dt * 0.8)
    p.vy += ((p.kind === "leaf" ? 55 : 32) - p.vy) * Math.min(1, dt * 1.5)
    pushFrom(pointer, p, dt, 120)
    p.x += (p.vx + Math.cos(p.phase) * p.sway) * dt
    p.y += (p.vy + Math.sin(p.phase * 2) * 10) * dt
    break
  case "firefly":
    stepFirefly(world, p, dt, pointer)
    return true
  default:
    // Ballistic: clumps, sparks, splashes, drops, meteors.
    var drag = p.kind === "clump" ? 0.6 : (p.kind === "spark" ? 1.4 : 0)
    var g = p.kind === "drop" || p.kind === "meteor" ? 0 : (p.kind === "spark" ? 420 : (p.kind === "splash" ? 1200 : GRAVITY))
    p.vx -= p.vx * drag * dt
    p.vy += g * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
  }

  if (p.kind === "spark" || p.kind === "splash" || p.kind === "ripple") return true
  if (p.y > world.height + 40 || p.x < -200 || p.x > world.width + 200) return false

  var hit = collide(world, x0, y0, p.x, p.y)
  if (!hit) return true
  return land(world, p, hit)
}

function land(world, p, hit) {
  var s = hit.surface
  switch (p.kind) {
  case "flake":
    deposit(world, s, p.x, 0.32 + p.r * 0.3)
    return false
  case "clump":
    deposit(world, s, p.x, p.amount)
    return false
  case "leaf":
  case "petal":
    p.rest = s.id
    p.ox = p.x - s.x
    p.vx = 0; p.vy = 0
    p.restAge = 0
    p.angle = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.35, 0.35)
    if (p.kind === "petal") p.restLeft = rand(TUNING.sakura.restMin, TUNING.sakura.restMax)
    p.life = p.age + 1e6
    return true
  case "drop":
    splash(world, p.x, hit.y)
    return false
  case "meteor":
    burst(world, p.x, hit.y, Math.floor(rand(12, 20)), [0, 1, 2])
    return false
  }
  return false
}

function stepResting(world, p, dt, pointer) {
  var s = world.surfaces[p.rest]
  if (!s) { p.rest = null; return true }
  p.restAge += dt
  p.x = s.x + p.ox
  p.y = s.y - heightAt(s, p.x) - 1
  if (p.kind === "petal") {
    p.restLeft -= dt
    if (p.restLeft <= 0) return false
  }
  // A pointer sweeping through scatters what rests on the ground or windows.
  if (pointer && p.kind === "leaf") {
    var dx = p.x - pointer.x, dy = p.y - pointer.y
    var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
    if (speed > 160 && dx * dx + dy * dy < 55 * 55) {
      release(p, s, (pointer.vx || 0) * 0.45 + (dx >= 0 ? 60 : -60), -rand(140, 280))
      p.y = s.y - 6
    }
  }
  return true
}

function pushFrom(pointer, p, dt, radius) {
  if (!pointer) return
  var dx = p.x - pointer.x, dy = p.y - pointer.y
  var d2 = dx * dx + dy * dy
  if (d2 > radius * radius || d2 < 1) return
  var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
  if (speed < 80) return
  var f = (1 - Math.sqrt(d2) / radius) * Math.min(speed, 1200) * 2.2 * dt
  var d = Math.sqrt(d2)
  p.vx += dx / d * f * 10
  p.vy += dy / d * f * 6
  p.spin += (Math.random() - 0.5) * f
}

function stepFirefly(world, p, dt, pointer) {
  p.phase += dt * p.blink * 2.4
  var still = pointer && (pointer.stillFor || 0) > 1.2
  var tx, ty, pull
  if (still) {
    // Circle the resting pointer.
    var ang = world.time * p.orbitSpeed + p.phase * 0.3
    tx = pointer.x + Math.cos(ang) * p.orbit
    ty = pointer.y + Math.sin(ang) * p.orbit * 0.7
    pull = 1.6
  } else {
    p.heading += rand(-1.6, 1.6) * dt
    tx = p.x + Math.cos(p.heading) * 60
    ty = p.y + Math.sin(p.heading) * 40
    pull = 0.6
    if (pointer) {
      var dx = p.x - pointer.x, dy = p.y - pointer.y
      var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
      if (speed > 300 && dx * dx + dy * dy < 140 * 140) {
        tx = p.x + dx * 2; ty = p.y + dy * 2; pull = 3
      }
    }
  }
  p.vx += ((tx - p.x) * pull - p.vx) * Math.min(1, dt * 1.8)
  p.vy += ((ty - p.y) * pull - p.vy) * Math.min(1, dt * 1.8)
  var max = still ? 160 : 70
  var sp = Math.hypot(p.vx, p.vy)
  if (sp > max) { p.vx *= max / sp; p.vy *= max / sp }
  p.x += p.vx * dt
  p.y += p.vy * dt
  // Keep them on screen: turn back softly at the edges.
  if (p.x < 10) { p.x = 10; p.heading = 0 }
  if (p.x > world.width - 10) { p.x = world.width - 10; p.heading = Math.PI }
  if (p.y < world.height * 0.1) { p.y = world.height * 0.1; p.heading = Math.PI / 2 }
  if (p.y > groundY(world) - 6) { p.y = groundY(world) - 6; p.heading = -Math.PI / 2 }
}

// Leaves pile up but never without limit: the oldest resting ones fade away.
function capResting(world) {
  var cap = TUNING.leaves.restCap
  var resting = []
  for (var i = 0; i < world.particles.length; i++) {
    var p = world.particles[i]
    if (p.kind === "leaf" && p.rest) resting.push(p)
  }
  if (resting.length <= cap) return
  resting.sort(function(a, b) { return b.restAge - a.restAge })
  var gone = resting.slice(0, resting.length - cap)
  world.particles = world.particles.filter(function(p) { return gone.indexOf(p) < 0 })
}

// Rest on window tops without letting window moves knock it off, for the QML
// decorations (snowmen) that ride on windows: the top of the pile under x.
function restingY(world, surfaceId, x) {
  var s = world.surfaces[surfaceId]
  if (!s) return null
  return s.y - heightAt(s, x)
}

// For tests and the status IPC.
function stats(world) {
  var counts = {}
  for (var i = 0; i < world.particles.length; i++) {
    var k = world.particles[i].kind
    counts[k] = (counts[k] || 0) + 1
  }
  return { effect: world.effect, particles: world.particles.length, kinds: counts,
           surfaces: world.order.length, snow: Math.round(totalSnow(world)) }
}
