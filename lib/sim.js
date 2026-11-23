.pragma library

// Flurry weather simulation.
//
// Pure JavaScript with no QML types, so the whole thing runs (and is tested)
// under node as well as inside the shell. One world per screen, in that
// screen's logical pixels, y pointing down. The QML side feeds it window
// rectangles and the pointer, steps it once per frame, and hands it to
// draw.js.
//
// The physics, in short:
//
//   * One gravity (G) for everything that has weight. Light things (flakes,
//     powder, petals) reach their terminal speed through drag against the
//     air, and the air itself moves: a slow wind, gusts that vary across the
//     screen, and the wake of a fast pointer.
//
//   * Surfaces are the exposed top edges things land on: every window on
//     the screen's active workspace plus the ground. Snow lies on them as a
//     height field (one bin per CELL px) that carries its own sliding speed
//     relative to the surface, so a pile can stick, creep, slide as a slab,
//     tear apart, and pour over an edge.
//
//   * Windows report positions only, so each surface tracks a smoothed
//     velocity and acceleration from those samples. In the window's frame
//     the snow feels gravity minus the window's acceleration. When the
//     sideways pull beats static friction the snow slides; kinetic friction
//     brakes it; whatever crosses an edge hangs as a small cornice and then
//     breaks off in chunks. If the window drops or stops climbing faster
//     than gravity the snow lifts off. A slow drag keeps the snow, a jerk
//     or a fling sheds it, and a hard stop throws it forward.
//
//   * Snow ages: fresh powder is loose, slides easily, and turns to dust
//     when it hits something; packed snow holds steeper slopes, sticks
//     better, and breaks into chunks. Falling chunks shed powder, break on
//     impact, and skid a little on whatever they land on.

var CELL = 4
var G = 1600                 // px/s², shared by everything with weight
var GRAVITY = G              // kept for callers of the earlier API
var GROUND_ID = "__ground"

var EFFECTS = ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]

// Per-effect tuning. Rates are spawns per second per 1000 px of screen width
// at intensity 1; fireflies are a population per 1000 px.
var TUNING = {
  snow:      { rate: 42,  cap: 14, groundCap: 26 },
  leaves:    { rate: 1.4, restCap: 140 },
  starfall:  { rate: 0.32 },
  rain:      { rate: 170 },
  sakura:    { rate: 3.2, restMin: 20, restMax: 40 },
  fireflies: { population: 12 }
}

// Snow material. Friction coefficients and repose slopes are interpolated
// between fresh powder (pack 0) and settled snow (pack 1).
var SNOW = {
  muStatic: [0.5, 1.0],       // sideways pull, in g, a pile resists before it slides
  muKinetic: 0.62,           // kinetic friction as a fraction of static
  repose: [0.85, 1.5],       // steepest stable slope (rise over run)
  cornice: [0.6, 2.2],       // how far past the repose slope an edge can hang, in cells
  chunk: [0.7, 4.5],         // mass of one falling chunk, in bin-px
  breakSpeed: 240,           // impact speed above which a chunk breaks up, px/s
  ageSeconds: 150,           // time for fresh snow to settle
  sprayFrom: 520,            // window speed above which loose powder blows off, px/s
  liftOff: 0.08              // lift-off when apparent gravity falls under this share of G
}

// The snow plow. Sizes are in px at a 1080 px tall screen and scale with
// the screen. It comes out when the ground snow passes `threshold` (mean
// depth as a share of the ground's capacity) and rests at least `rest`
// seconds between runs.
var PLOW = {
  threshold: 0.42,
  rest: 6,
  speed: 150,                // cruising speed, px/s
  accel: 0.9,                // s to close most of the gap to the target speed
  bodyLength: 160,           // blade edge to the back of the ripper
  bladeHeight: 34,
  roof: { back: -134, length: 50, height: 98 },
  stack: { x: -58, y: -86 },
  loadDrag: 400,             // berm mass (bin-px) that halves its speed
  minSpeedShare: 0.5,        // a full berm slows it to this share of cruising
  bermMax: 1.6,              // tallest berm, as a share of the blade's height
  liftSpeed: 1.6             // blade travel, full range per second
}
var PLOW_ID = "__plow"

var MAX_SPEED = 3200         // px/s cap on a window's estimated speed
var STALE = 0.12             // s without a new sample before a window counts as stopped

function rand(a, b) { return a + Math.random() * (b - a) }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
function lerp(a, b, t) { return a + (b - a) * t }
function pick(list) { return list[Math.floor(Math.random() * list.length)] }
function mix(range, t) { return lerp(range[0], range[1], clamp(t, 0, 1)) }
function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0) }
// Fraction of the way a first-order lag moves toward its target in dt.
function follow(dt, tau) { return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau) }

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
    frame: 0,
    particles: [],
    surfaces: {},
    stash: {},
    order: [],
    spawnDebt: 0,
    wind: 0,
    windTarget: 0,
    windTimer: 0,
    flash: 0,
    bolt: null,
    nextLightning: rand(10, 30),
    pendingFlash: -1,
    lastSurfaceTime: -1,
    plow: null,
    plowEnabled: opts.plow === undefined ? true : !!opts.plow,
    plowRest: 0,
    plowCheck: 0,
    plowDir: 1,
    plowRuns: 0
  }
  world.surfaces[GROUND_ID] = makeSurface(GROUND_ID, 0, groundY(world), world.width, true)
  rebuildOrder(world)
  return world
}

function groundY(world) { return world.height - world.groundInset }

function zeros(n) {
  var a = new Array(n)
  for (var i = 0; i < n; i++) a[i] = 0
  return a
}

function makeSurface(id, x, y, w, ground) {
  var n = Math.max(1, Math.ceil(w / CELL))
  var s = {
    id: id, x: x, y: y, w: w, h: 0,
    ground: !!ground, floating: false, z: ground ? 1e9 : 0,
    bins: zeros(n),          // snow depth per cell, px
    slip: zeros(n),          // sliding speed of that snow relative to the surface, px/s
    grip: zeros(n),          // per-cell friction jitter, so a slab tears instead of moving as one
    pack: 0.5,               // 0 fresh powder .. 1 settled
    front: [], seen: true,
    vx: 0, vy: 0, ax: 0, ay: 0,
    rawVx: 0, rawVy: 0, sampleT: -1,
    py: y,                   // top at the start of the current step, for swept collisions
    edges: [{ m: 0, mom: 0, age: 0 }, { m: 0, mom: 0, age: 0 }],
    sliding: false
  }
  for (var i = 0; i < n; i++) s.grip[i] = rand(0.78, 1.22)
  return s
}

function resize(world, width, height, groundInset) {
  world.width = Math.max(1, width | 0)
  world.height = Math.max(1, height | 0)
  if (groundInset !== undefined) world.groundInset = groundInset
  var g = world.surfaces[GROUND_ID]
  var fresh = makeSurface(GROUND_ID, 0, groundY(world), world.width, true)
  for (var i = 0; i < Math.min(g.bins.length, fresh.bins.length); i++) fresh.bins[i] = g.bins[i]
  fresh.pack = g.pack
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

// ------------------------------------------------------------------ air

// Horizontal air speed at a point: the slow wind plus gusts that drift
// across the screen, so neighbouring flakes move together but not in
// lockstep. The field is sampled once a frame on a coarse grid and read
// back bilinearly, which keeps the per-particle cost to a few multiplies.
var AIR_CELL = 96

function airSample(world, x, y) {
  var t = world.time
  var gust = Math.sin(x * 0.0037 + t * 0.61) * 0.55 + Math.sin(x * 0.0011 - y * 0.0047 + t * 0.23) * 0.45
  var swirl = Math.sin(y * 0.011 + x * 0.003 + t * 1.3) * 7
  var strength = world.effect === "rain" ? 55 : 14
  return world.wind + gust * strength + swirl
}

function updateAir(world) {
  var cols = Math.ceil((world.width + 640) / AIR_CELL) + 2
  var rows = Math.ceil((world.height + 160) / AIR_CELL) + 2
  var grid = world.air
  if (!grid || grid.length !== cols * rows) grid = world.air = zeros(cols * rows)
  world.airCols = cols
  world.airRows = rows
  for (var r = 0; r < rows; r++) {
    var y = r * AIR_CELL - 120
    for (var c = 0; c < cols; c++) grid[r * cols + c] = airSample(world, c * AIR_CELL - 320, y)
  }
}

function airAt(world, x, y) {
  var grid = world.air
  if (!grid) return airSample(world, x, y)
  var cols = world.airCols, rows = world.airRows
  var fx = clamp((x + 320) / AIR_CELL, 0, cols - 1.001)
  var fy = clamp((y + 120) / AIR_CELL, 0, rows - 1.001)
  var c = Math.floor(fx), r = Math.floor(fy)
  var tx = fx - c, ty = fy - r
  var i = r * cols + c
  var a = grid[i] + (grid[i + 1] - grid[i]) * tx
  var b = grid[i + cols] + (grid[i + cols + 1] - grid[i + cols]) * tx
  return a + (b - a) * ty
}

// Air pushed along by a fast pointer: a soft wake, strongest at the cursor.
function pointerWake(pointer, x, y, radius) {
  if (!pointer) return null
  var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
  if (speed < 60) return null
  var dx = x - pointer.x, dy = y - pointer.y
  var d2 = dx * dx + dy * dy
  if (d2 > radius * radius) return null
  var d = Math.sqrt(d2) || 1
  var f = 1 - d / radius
  f = f * f
  var carry = Math.min(speed, 1400) / speed
  // Air is dragged along with the pointer and thrown outward from its path.
  return {
    x: (pointer.vx || 0) * carry * f * 0.55 + dx / d * f * Math.min(speed, 1400) * 0.25,
    y: (pointer.vy || 0) * carry * f * 0.45 + dy / d * f * Math.min(speed, 1400) * 0.18
  }
}

// ------------------------------------------------------------------ surfaces

// rects: [{ id, x, y, w, h, floating, z }] in screen-local px, z lower = in
// front (Hyprland's focusHistoryID). alive: optional ids of windows that
// still exist on other workspaces; their snow is put aside, not dropped.
function setSurfaces(world, rects, now, alive) {
  var t = world.time
  var seen = {}
  var keep = {}
  if (alive) for (var a = 0; a < alive.length; a++) keep[String(alive[a])] = true
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i]
    if (!r || !r.id || r.w < 8 || r.h < 8) continue
    var id = String(r.id)
    seen[id] = true
    var s = world.surfaces[id]
    if (!s) {
      s = restore(world, id, r) || makeSurface(id, r.x, r.y, r.w, false)
      s.x = r.x; s.y = r.y; s.py = r.y
      s.sampleT = t
      world.surfaces[id] = s
    } else {
      track(world, s, r, t)
    }
    s.w = r.w; s.h = r.h
    s.floating = !!r.floating
    s.z = r.z === undefined ? 0 : r.z
  }
  var ids = Object.keys(world.surfaces)
  for (var j = 0; j < ids.length; j++) {
    var sid = ids[j]
    if (sid === GROUND_ID || sid === PLOW_ID || seen[sid]) continue
    var gone = world.surfaces[sid]
    delete world.surfaces[sid]
    if (keep[sid]) stashSurface(world, gone)
    else spill(world, gone)
  }
  world.lastSurfaceTime = t
  rebuildOrder(world)
}

// A window's new rectangle. A pure move feeds its velocity estimate; a
// resize keeps the snow where it lies on screen and drops what the window
// no longer reaches.
function track(world, s, r, t) {
  var dx = r.x - s.x, dy = r.y - s.y
  var resized = Math.abs(r.w - s.w) > 0.5 || Math.abs(r.h - s.h) > 0.5
  var dt = s.sampleT < 0 ? 0 : t - s.sampleT
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resized) return
  if (resized) {
    remap(world, s, r.x, r.w)
    s.x = r.x
    s.y = r.y
    s.rawVx = 0
    s.rawVy = 0
  } else {
    // Several samples can land in one frame, so never divide by less than a
    // frame. After a rest the window moved at some point since the last
    // poll; assume it did so within the last tenth of a second.
    var span = clamp(dt, 1 / 120, 0.1)
    var vx = dx / span, vy = dy / span
    var sp = Math.hypot(vx, vy)
    if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp }
    s.rawVx = vx
    s.rawVy = vy
    s.x = r.x
    s.y = r.y
  }
  s.sampleT = t
}

// Re-cut the height field for a new left edge and width, keeping each cell's
// snow at the same place on screen.
function remap(world, s, nx, nw) {
  var n = Math.max(1, Math.ceil(nw / CELL))
  var bins = zeros(n), slip = zeros(n), grip = new Array(n)
  for (var j = 0; j < n; j++) grip[j] = rand(0.78, 1.22)
  var shift = (s.x - nx) / CELL
  for (var i = 0; i < s.bins.length; i++) {
    var h = s.bins[i]
    var k = Math.round(i + shift)
    if (k >= 0 && k < n) {
      bins[k] += h
      slip[k] = s.slip[i]
      grip[k] = s.grip[i]
    } else if (h > 0.05) {
      // Off the new edge: it falls from where it was.
      spawnChunks(world, s.x + (i + 0.5) * CELL, s.y - h * 0.5, h, s.vx, s.vy, s.pack)
    }
  }
  s.bins = bins
  s.slip = slip
  s.grip = grip
  for (var p = 0; p < world.particles.length; p++) {
    var q = world.particles[p]
    if (q.rest === s.id) {
      q.ox += s.x - nx
      if (q.ox < 0 || q.ox > nw) release(q, s, s.vx, s.vy)
    }
  }
}

function stashSurface(world, s) {
  var mass = sumOf(s.bins)
  if (mass < 0.5) return
  world.stash[s.id] = { bins: s.bins.slice(), pack: s.pack, w: s.w, at: world.time }
}

function restore(world, id, r) {
  var saved = world.stash[id]
  if (!saved) return null
  delete world.stash[id]
  var s = makeSurface(id, r.x, r.y, r.w, false)
  // Snow put aside melts a little while its window is out of sight.
  var keep = Math.exp(-(world.time - saved.at) / 1800)
  for (var i = 0; i < Math.min(s.bins.length, saved.bins.length); i++) s.bins[i] = saved.bins[i] * keep
  s.pack = Math.min(1, saved.pack + 0.2)
  return s
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
// focused is on top. The ground is behind everything for collisions.
function inFront(a, b) {
  if (a.ground !== b.ground) return b.ground
  if (a.floating !== b.floating) return a.floating
  return a.z < b.z
}

function overlaps(a, b) {
  var reach = TUNING.snow.cap * 2
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + Math.max(b.h, 1) && b.y - reach < a.y + Math.max(a.h, 1)
}

function covered(s, x, y) {
  for (var i = 0; i < s.front.length; i++) {
    var o = s.front[i]
    if (x >= o.x && x <= o.x + o.w && y >= o.y - 1 && y <= o.y + o.h) return true
  }
  return false
}

// A closing window drops everything on it: the snow keeps the window's
// last motion and falls.
function spill(world, s) {
  for (var i = 0; i < s.bins.length; i++) {
    var h = s.bins[i]
    if (h < 0.05) continue
    spawnChunks(world, s.x + (i + 0.5) * CELL, s.y - h * 0.5, h, s.vx + s.slip[i], s.vy, s.pack)
    s.bins[i] = 0
  }
  for (var e = 0; e < 2; e++) flushEdge(world, s, e)
  for (var k = 0; k < world.particles.length; k++) {
    var p = world.particles[k]
    if (p.rest === s.id) release(p, s, s.vx, s.vy)
  }
}

function sumOf(a) {
  var t = 0
  for (var i = 0; i < a.length; i++) t += a[i]
  return t
}

// Snow depth under x, interpolated between cell centres.
function heightAt(s, x) {
  var n = s.bins.length
  var f = (x - s.x) / CELL - 0.5
  if (f < -0.5 || f > n - 0.5) return 0
  var i = Math.floor(f)
  var t = f - i
  var a = s.bins[clamp(i, 0, n - 1)]
  var b = s.bins[clamp(i + 1, 0, n - 1)]
  return a + (b - a) * t
}

// Where a particle moving from (x0,y0) to (x1,y1) during this step first
// meets an exposed top. Tops move too: a window rising into falling snow
// scoops it up, one dropping away leaves it in the air.
function collide(world, x0, y0, x1, y1) {
  var reach = TUNING.snow.groundCap * 1.4 + 1
  for (var i = 0; i < world.order.length; i++) {
    var s = world.order[i]
    // Cheap rejects first: still above the tallest pile, or already below
    // the top at both ends of the step.
    if (y1 < s.y - reach) continue
    if (y0 > (s.py > s.y ? s.py : s.y) + 0.5) continue
    if (x1 < s.x || x1 > s.x + s.w) continue
    var h = heightAt(s, x1)
    var top1 = s.y - h
    var top0 = s.py - h
    if (y0 <= top0 + 0.5 && y1 >= top1) {
      if (!s.ground && covered(s, x1, top1)) continue
      return { surface: s, y: top1 }
    }
  }
  return null
}

// Add snow at x, split between the two nearest cells. `drift` is the
// sliding speed the new snow brings relative to the surface.
function deposit(world, s, x, amount, drift) {
  var n = s.bins.length
  var f = clamp((x - s.x) / CELL - 0.5, 0, n - 1)
  var i = Math.floor(f)
  var t = f - i
  var cap = s.ground ? TUNING.snow.groundCap : TUNING.snow.cap
  addTo(s, i, amount * (1 - t), drift || 0, cap)
  if (i + 1 < n) addTo(s, i + 1, amount * t, drift || 0, cap)
  // Fresh snow lowers the pile's age in proportion to what it adds.
  var mass = sumOf(s.bins)
  if (mass > 0) s.pack = s.pack * Math.max(0, 1 - amount / mass)
}

function addTo(s, i, m, drift, cap) {
  if (m <= 0) return
  var h = s.bins[i]
  // Near the cap, fresh snow mostly blows off instead of building up.
  var room = clamp((cap - h) / (cap * 0.35), 0.04, 1)
  m *= room
  var total = h + m
  s.slip[i] = total > 0 ? (s.slip[i] * h + drift * m) / total : 0
  s.bins[i] = total
  if (drift) s.sliding = true
}

// ------------------------------------------------------------------ snow on surfaces

function stepSurface(world, s, dt) {
  s.py = s.py === undefined ? s.y : s.py
  if (!s.ground) kinematics(world, s, dt)

  var b = s.bins
  var mass = sumOf(b)
  if (mass < 0.01 && !edgeLoaded(s)) {
    if (mass > 0) for (var z = 0; z < b.length; z++) b[z] = 0
    s.sliding = false
    return
  }

  // Apparent gravity in the window's frame.
  var geff = G - s.ay
  if (!s.ground && geff < G * SNOW.liftOff && mass > 0.05) {
    liftOff(world, s)
    return
  }

  if (!s.ground || s.sliding) slide(world, s, dt, geff)
  slump(world, s, dt)
  if (!s.ground) {
    spray(world, s, dt)
    for (var e = 0; e < 2; e++) breakEdge(world, s, e, dt)
  }
  drift(world, s, dt)

  // Snow settles with time; settled snow holds together.
  s.pack += (1 - s.pack) * dt / SNOW.ageSeconds

  if (world.effect !== "snow") melt(s, dt, s.ground ? 30 : 25)
  else if (s.ground) melt(s, dt, 900)
}

function edgeLoaded(s) { return s.edges && (s.edges[0].m > 0 || s.edges[1].m > 0) }

// Smoothed velocity and acceleration of a window from its position samples.
// No new sample for a while means it stopped, which is itself a jolt.
function kinematics(world, s, dt) {
  if (dt <= 0) return
  var stale = s.sampleT < 0 || world.time - s.sampleT > STALE
  var tx = stale ? 0 : s.rawVx
  var ty = stale ? 0 : s.rawVy
  var k = follow(dt, 0.05)
  var nvx = s.vx + (tx - s.vx) * k
  var nvy = s.vy + (ty - s.vy) * k
  var ka = follow(dt, 0.035)
  s.ax += ((nvx - s.vx) / dt - s.ax) * ka
  s.ay += ((nvy - s.vy) / dt - s.ay) * ka
  s.vx = Math.abs(nvx) < 0.5 ? 0 : nvx
  s.vy = Math.abs(nvy) < 0.5 ? 0 : nvy
  if (s.vx === 0 && Math.abs(s.ax) < 1) s.ax = 0
  if (s.vy === 0 && Math.abs(s.ay) < 1) s.ay = 0
}

// Friction against the surface, per cell. A cell at rest stays put until
// the sideways pull beats its grip; a sliding cell is braked by kinetic
// friction and sticks again once it stops. Neighbours drag on each other in
// proportion to how settled the snow is, so packed snow slides as slabs and
// powder smears and tears.
function slide(world, s, dt, geff) {
  var b = s.bins, u = s.slip, n = b.length
  var muS = mix(SNOW.muStatic, s.pack)
  var muK = muS * SNOW.muKinetic
  var pull = -s.ax                        // pseudo-force in the window's frame
  var normal = Math.max(0, geff)
  var moving = false
  for (var i = 0; i < n; i++) {
    if (b[i] < 0.02) { u[i] = 0; continue }
    var grip = muS * s.grip[i] * normal
    if (u[i] === 0) {
      if (Math.abs(pull) <= grip) continue
      // Breaks loose: the excess over static friction starts it moving.
      u[i] = (pull - sign(pull) * muK * normal) * dt
    } else {
      var before = u[i]
      u[i] += (pull - sign(u[i]) * muK * s.grip[i] * normal) * dt
      if (sign(u[i]) !== sign(before) && Math.abs(pull) <= grip) u[i] = 0
    }
    if (u[i] !== 0) moving = true
  }
  if (!moving) { s.sliding = false; return }
  s.sliding = true

  // Cohesion: neighbouring snow pulls each other's speed together.
  var bond = follow(dt, 1 / (6 + 22 * s.pack))
  for (var j = 0; j + 1 < n; j++) {
    var ma = b[j], mb = b[j + 1]
    if (ma < 0.02 || mb < 0.02) continue
    var avg = (u[j] * ma + u[j + 1] * mb) / (ma + mb)
    u[j] += (avg - u[j]) * bond
    u[j + 1] += (avg - u[j + 1]) * bond
  }
  advect(world, s, dt)
}

// Move each cell's snow by its sliding speed, conserving mass and momentum.
// What crosses an edge collects there as an overhang.
function advect(world, s, dt) {
  var b = s.bins, u = s.slip, n = b.length
  var nb = zeros(n), nm = zeros(n)
  var outL = 0, outLm = 0, outR = 0, outRm = 0
  for (var i = 0; i < n; i++) {
    var h = b[i]
    if (h <= 0) continue
    var f = i + u[i] * dt / CELL
    var i0 = Math.floor(f)
    var t = f - i0
    for (var k = 0; k < 2; k++) {
      var j = i0 + k, m = k === 0 ? h * (1 - t) : h * t
      if (m <= 0) continue
      if (j < 0) { outL += m; outLm += m * u[i] }
      else if (j >= n) { outR += m; outRm += m * u[i] }
      else { nb[j] += m; nm[j] += m * u[i] }
    }
  }
  for (var c = 0; c < n; c++) {
    b[c] = nb[c]
    u[c] = nb[c] > 1e-6 ? nm[c] / nb[c] : 0
  }
  if (s.ground) return
  if (outL > 0) feedEdge(s, 0, outL, outLm)
  if (outR > 0) feedEdge(s, 1, outR, outRm)
}

function feedEdge(s, side, m, mom) {
  var e = s.edges[side]
  e.m += m
  e.mom += mom
}

// The overhang at an edge breaks off once it is heavier than the snow can
// hold, or after a moment if it is sliding fast. Packed snow goes in
// chunks, powder pours.
function breakEdge(world, s, side, dt) {
  var e = s.edges[side]
  if (e.m <= 0) { e.age = 0; return }
  e.age += dt
  var u = e.mom / e.m
  var hold = mix(SNOW.chunk, s.pack) * rand(0.8, 1.6)
  if (e.m < hold && e.age < 0.06 + 0.25 * s.pack && Math.abs(u) < 260) return
  flushEdge(world, s, side)
}

function flushEdge(world, s, side) {
  var e = s.edges[side]
  if (e.m <= 0) return
  var u = e.mom / e.m
  var x = side === 0 ? s.x - 2 : s.x + s.w + 2
  var h = side === 0 ? s.bins[0] : s.bins[s.bins.length - 1]
  spawnChunks(world, x, s.y - Math.max(1, h * 0.6), e.m, s.vx + u, s.vy - rand(0, 20), s.pack)
  e.m = 0; e.mom = 0; e.age = 0
}

// Avalanching: wherever the slope between two cells is steeper than the
// snow can stand, the excess flows downhill, keeping its speed. At a
// window's edge the snow can hang a little past that before pouring over.
function slump(world, s, dt) {
  var b = s.bins, u = s.slip, n = b.length
  var maxD = mix(SNOW.repose, s.pack) * CELL
  var rate = follow(dt, 0.08)
  var cap = (s.ground ? TUNING.snow.groundCap : TUNING.snow.cap) * 1.35
  // Alternate the sweep direction so the flow has no bias.
  var forward = (world.frame & 1) === 0
  for (var k = 0; k + 1 < n; k++) {
    var i = forward ? k : n - 2 - k
    var d = b[i] - b[i + 1]
    var ad = Math.abs(d)
    if (ad <= maxD) continue
    var from = d > 0 ? i : i + 1
    var to = d > 0 ? i + 1 : i
    var m = Math.min(b[from], (ad - maxD) * 0.5 * rate)
    var total = b[to] + m
    u[to] = total > 0 ? (u[to] * b[to] + u[from] * m) / total : 0
    b[from] -= m
    b[to] = total
  }
  for (var c = 0; c < n; c++) if (b[c] > cap) b[c] = cap
  if (s.ground || n < 2) return
  var hang = maxD + mix(SNOW.cornice, s.pack) * CELL * 0.5
  var ends = [0, n - 1]
  for (var e = 0; e < 2; e++) {
    var idx = ends[e]
    if (b[idx] <= hang) continue
    var spill = (b[idx] - hang) * 0.5 * rate
    b[idx] -= spill
    feedEdge(s, e, spill, spill * (e === 0 ? -30 : 30))
  }
}

// A window moving fast through the air strips loose powder off the top of
// its pile. The powder keeps the window's speed and is braked by the air,
// so it trails behind as a plume.
function spray(world, s, dt) {
  var speed = Math.hypot(s.vx, s.vy)
  if (speed < SNOW.sprayFrom) return
  var looseness = 1 - 0.8 * s.pack
  var rate = (speed - SNOW.sprayFrom) / 1400 * looseness * 3
  var budget = 24
  var b = s.bins
  for (var i = 0; i < b.length && budget > 0; i++) {
    if (b[i] < 0.6 || Math.random() > rate * dt) continue
    var take = Math.min(b[i] * 0.12, 0.5)
    b[i] -= take
    budget--
    addPowder(world, s.x + (i + 0.5) * CELL, s.y - b[i] - rand(0, 2),
              s.vx * rand(0.75, 1) + s.slip[i], s.vy - rand(10, 60), take)
  }
}

// Wind slowly moves loose snow downwind and blows a little off the end.
function drift(world, s, dt) {
  var w = world.wind
  if (Math.abs(w) < 14 || s.pack > 0.7) return
  var b = s.bins, n = b.length
  var k = (Math.abs(w) - 14) * 0.0012 * (1 - s.pack) * dt
  if (w > 0) {
    for (var i = n - 1; i > 0; i--) { var m = b[i - 1] * k; b[i - 1] -= m; b[i] += m }
    if (s.ground) b[n - 1] -= b[n - 1] * k * 4      // blown off the screen
    else if (b[n - 1] > 1) lose(world, s, n - 1, b[n - 1] * k, w)
  } else {
    for (var j = 0; j + 1 < n; j++) { var q = b[j + 1] * k; b[j + 1] -= q; b[j] += q }
    if (s.ground) b[0] -= b[0] * k * 4
    else if (b[0] > 1) lose(world, s, 0, b[0] * k, w)
  }
}

function lose(world, s, i, m, w) {
  s.bins[i] -= m
  if (Math.random() < 0.15) addPowder(world, s.x + (i + 0.5) * CELL, s.y - s.bins[i], s.vx + w, s.vy - rand(5, 30), m * 6)
}

// The window dropped (or stopped rising) faster than gravity: the snow
// keeps the motion it had and parts from the surface.
function liftOff(world, s) {
  var b = s.bins
  for (var i = 0; i < b.length; i++) {
    if (b[i] < 0.05) continue
    spawnChunks(world, s.x + (i + 0.5) * CELL, s.y - b[i] * 0.5 - 1, b[i],
                s.vx + s.slip[i], s.vy - s.ay * 0.016, s.pack)
    b[i] = 0
    s.slip[i] = 0
  }
  for (var e = 0; e < 2; e++) flushEdge(world, s, e)
  s.sliding = false
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
    var s = world.surfaces[id]
    sum += sumOf(s.bins) + s.edges[0].m + s.edges[1].m
  }
  return sum
}

// ------------------------------------------------------------------ chunks and powder

function maxParticles(world) { return Math.round(1500 * world.quality) }

// Break `amount` of snow into falling chunks. Packed snow makes a few solid
// chunks, powder makes small ones and a puff of dust. Over the particle
// budget, it all goes as one chunk so no snow is lost.
function spawnChunks(world, x, y, amount, vx, vy, pack) {
  if (amount <= 0) return
  pack = pack === undefined ? 0.5 : pack
  var cap = maxParticles(world)
  var crowded = world.particles.length > cap
  var dust = crowded ? 0 : amount * (1 - pack) * 0.12
  var solid = amount - dust
  var piece = mix(SNOW.chunk, pack)
  var count = crowded ? 1 : clamp(Math.round(solid / piece), 1, 6)
  for (var c = 0; c < count; c++) {
    var m = solid / count
    world.particles.push({
      kind: "clump",
      x: x + rand(-CELL, CELL), y: y + rand(-2, 1),
      vx: vx + rand(-30, 30) * (1 - pack * 0.5), vy: vy + rand(-25, 10),
      r: chunkRadius(m),
      amount: m, pack: pack,
      angle: rand(0, 6.28), spin: rand(-5, 5),
      life: 12, age: 0, rest: null
    })
  }
  var puffs = Math.min(2, Math.ceil(dust / 0.3))
  for (var d = 0; d < puffs; d++) addPowder(world, x + rand(-3, 3), y + rand(-3, 2), vx + rand(-40, 40), vy + rand(-40, 0), dust / puffs)
}

// A chunk's radius from its mass: mass is in bin-px (one cell wide, px
// deep), so its area is mass * CELL and the chunk is a disc of that area,
// a little fluffed up.
function chunkRadius(m) { return clamp(Math.sqrt(m * CELL / Math.PI), 1, 5) }

function addPowder(world, x, y, vx, vy, amount) {
  if (world.particles.length > maxParticles(world) * 1.2) return
  world.particles.push({
    kind: "powder", x: x, y: y, vx: vx, vy: vy,
    r: rand(0.6, 1.4), amount: amount || 0,
    vt: rand(60, 120), life: rand(0.8, 1.8), age: 0, rest: null
  })
}

// A chunk hits a surface. A gentle landing keeps it whole; a hard one
// breaks it: some of it sprays up as smaller bits and dust, the rest
// spreads over a few cells and skids along with the speed it came in with.
function impact(world, p, s, y) {
  var rvx = p.vx - s.vx, rvy = p.vy - s.vy
  var speed = Math.hypot(rvx, rvy)
  var pack = p.pack === undefined ? 0.5 : p.pack
  var m = p.amount
  if (speed > SNOW.breakSpeed && m > 0.4 && world.particles.length < maxParticles(world)) {
    var shatter = clamp((speed - SNOW.breakSpeed) / 900, 0.08, 0.5) * (1 - 0.4 * pack)
    var flying = m * shatter
    m -= flying
    var bits = clamp(Math.round(flying / 0.35), 1, 5)
    for (var i = 0; i < bits; i++) {
      var piece = flying / bits
      var up = rand(0.12, 0.3) * Math.min(speed, 900)
      var side = rvx * rand(0.2, 0.45) + rand(-1, 1) * speed * 0.18
      if (pack > 0.45 && piece > 0.3) {
        world.particles.push({
          kind: "clump", x: p.x, y: y - 1, vx: s.vx + side, vy: s.vy - up,
          r: chunkRadius(piece), amount: piece, pack: pack,
          angle: rand(0, 6.28), spin: rand(-9, 9), life: 6, age: 0, rest: null
        })
      } else {
        addPowder(world, p.x, y - 1, s.vx + side, s.vy - up, piece)
      }
    }
  }
  // Spread over the footprint, wider the harder it hit.
  var spread = Math.max(1, Math.round(1 + speed / 320 + p.r / CELL))
  var skid = clamp(rvx * 0.35, -220, 220)
  for (var k = 0; k < spread; k++) {
    var off = (k - (spread - 1) / 2) * CELL
    deposit(world, s, p.x + off + skid * 0.01, m / spread, skid)
  }
  // Chunks are older snow than fresh flakes: blend the pile's age back up.
  var mass = sumOf(s.bins)
  if (mass > 0) s.pack = clamp(s.pack + (pack - s.pack) * Math.min(1, p.amount / mass), 0, 1)
}

// ------------------------------------------------------------------ spawning

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
  // Weather gets most of the budget; the rest is kept for chunks and dust.
  var cap = Math.round(maxParticles(world) * 0.72)
  while (world.spawnDebt >= 1) {
    world.spawnDebt -= 1
    if (world.particles.length >= cap) { world.spawnDebt = 0; break }
    world.particles.push(makeParticle(world))
  }
}

function makeParticle(world) {
  var x = rand(-60, world.width + 60)
  switch (world.effect) {
  case "snow":
    // Depth stands in for distance: far flakes are small, dim and slow.
    var depth = Math.random()
    var r = 0.9 + depth * 2.4
    var vt = 34 + depth * 62 + rand(-6, 6)
    return { kind: "flake", x: x, y: rand(-24, -4), vx: world.wind, vy: vt * rand(0.6, 1),
             r: r, depth: depth, vt: vt, phase: rand(0, 6.28), freq: rand(0.6, 1.4),
             sway: rand(6, 20) * (1.2 - depth * 0.5),
             life: 180, age: 0, rest: null }
  case "leaves":
    return { kind: "leaf", x: x, y: -16, vx: rand(-20, 20), vy: rand(40, 70), r: rand(6, 10),
             vt: rand(70, 110), angle: rand(0, 6.28), spin: 0, phase: rand(0, 6.28),
             freq: rand(1.3, 2.1), sway: rand(40, 80), tilt: rand(-0.4, 0.4),
             hue: Math.floor(rand(0, 4)), life: 600, age: 0, rest: null }
  case "sakura":
    return { kind: "petal", x: x, y: -10, vx: rand(10, 35), vy: rand(22, 40), r: rand(3.5, 6),
             vt: rand(38, 58), angle: rand(0, 6.28), spin: 0, phase: rand(0, 6.28),
             freq: rand(1.8, 2.8), sway: rand(18, 38), tilt: rand(-0.5, 0.5),
             hue: Math.floor(rand(0, 3)), life: 600, age: 0, rest: null, restLeft: 0 }
  case "rain":
    return { kind: "drop", x: rand(-120, world.width + 120), y: rand(-60, -10), vx: world.wind,
             vy: rand(1050, 1350), len: rand(12, 22), life: 4, age: 0, rest: null }
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
                           r: rand(0.8, 1.8), life: rand(0.6, 1.2), age: 0, rest: null,
                           hue: palette ? pick(palette) : 0 })
  }
}

// A raindrop breaks into a few droplets thrown up and sideways, carrying
// some of the drop's sideways speed, plus a ripple.
function splash(world, x, y, vx) {
  var n = Math.floor(rand(2, 5))
  for (var i = 0; i < n; i++) {
    world.particles.push({ kind: "splash", x: x, y: y - 1, vx: vx * 0.3 + rand(-120, 120), vy: rand(-230, -90),
                           r: rand(0.7, 1.3), life: rand(0.3, 0.5), age: 0, rest: null })
  }
  world.particles.push({ kind: "ripple", x: x, y: y, life: 0.3, age: 0, rest: null, w: rand(6, 12) })
}

// ------------------------------------------------------------------ stepping

// input: { pointer: {x, y, vx, vy, present, stillFor} }
function step(world, dt, input) {
  if (!world.running) return
  dt = clamp(dt, 0, 0.05)
  if (dt <= 0) return
  world.time += dt
  world.frame++
  input = input || {}
  var pointer = input.pointer && input.pointer.present ? input.pointer : null

  // Wind drifts slowly between gusts.
  world.windTimer -= dt
  if (world.windTimer <= 0) {
    world.windTimer = rand(4, 10)
    world.windTarget = world.effect === "rain" ? rand(-140, 140) : rand(-28, 28)
  }
  world.wind += (world.windTarget - world.wind) * follow(dt, 2)
  updateAir(world)

  spawn(world, dt)
  if (world.effect === "rain") lightning(world, dt)
  else { world.flash = Math.max(0, world.flash - dt * 4); world.bolt = null }

  stepPlow(world, dt)
  for (var i = 0; i < world.order.length; i++) stepSurface(world, world.order[i], dt)

  var keep = []
  var list = world.particles
  var count = list.length
  for (var j = 0; j < count; j++) {
    var p = list[j]
    p.age += dt
    if (p.age >= p.life) continue
    if (stepParticle(world, p, dt, pointer)) keep.push(p)
  }
  // Particles born during the loop (bursts, chunks, dust) join next frame.
  for (var k = count; k < list.length; k++) keep.push(list[k])
  world.particles = keep
  capResting(world)

  for (var m = 0; m < world.order.length; m++) world.order[m].py = world.order[m].y
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

// Light bodies: velocity relaxes toward the local air plus their own fall
// speed. The time constant is vt / G, which is what a drag that balances
// gravity at vt gives, so heavier things respond more slowly.
function relax(world, p, dt, ax, ay, vt, pointer, wakeRadius) {
  var wake = pointerWake(pointer, p.x, p.y, wakeRadius)
  var airX = ax + (wake ? wake.x : 0)
  var airY = (wake ? wake.y : 0)
  var k = follow(dt, Math.max(0.02, vt / G))
  p.vx += (airX - p.vx) * k
  p.vy += (airY + vt - p.vy) * k
}

function stepParticle(world, p, dt, pointer) {
  if (p.rest !== null && p.rest !== undefined) return stepResting(world, p, dt, pointer)
  var x0 = p.x, y0 = p.y
  switch (p.kind) {
  case "flake":
    // A flake tumbles: its own small side-to-side flutter on top of the air.
    p.phase += dt * p.freq * 2.2
    var air = airAt(world, p.x, p.y) * (0.45 + 0.55 * p.depth)
    relax(world, p, dt, air + Math.sin(p.phase) * p.sway, 0, p.vt * (0.88 + 0.12 * Math.cos(p.phase * 1.7)), pointer, 110)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "powder":
    relax(world, p, dt, airAt(world, p.x, p.y), 0, p.vt, pointer, 110)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "leaf":
  case "petal":
    stepFlutter(world, p, dt, pointer)
    break
  case "firefly":
    stepFirefly(world, p, dt, pointer)
    return true
  case "clump":
    // Heavy: gravity with quadratic drag toward a high terminal speed, and
    // a loose chunk sheds dust as it falls.
    var vt = 420 + p.r * 110
    var rvx = p.vx - airAt(world, p.x, p.y), rvy = p.vy
    var sp = Math.hypot(rvx, rvy)
    var c = G / (vt * vt)
    p.vx -= c * sp * rvx * dt
    p.vy += (G - c * sp * rvy) * dt
    p.angle += p.spin * dt
    var loose = 1 - (p.pack === undefined ? 0.5 : p.pack)
    if (p.amount > 0.3 && sp > 160 && Math.random() < dt * 2.5 * loose) {
      var bit = Math.min(p.amount * 0.08, 0.15)
      p.amount -= bit
      p.r = chunkRadius(p.amount)
      addPowder(world, p.x, p.y, p.vx * 0.6, p.vy * 0.5, bit)
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "spark":
    // Embers: little weight, a lot of drag.
    var ks = follow(dt, 0.35)
    p.vx += (airAt(world, p.x, p.y) * 0.3 - p.vx) * ks
    p.vy += (G * 0.25 * 0.35 - p.vy) * ks * 0.5 + G * 0.12 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    return true
  case "splash":
    var kd = follow(dt, 0.4)
    p.vx -= p.vx * kd * 0.5
    p.vy += G * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    return true
  case "ripple":
    return true
  case "drop":
    // Already at terminal speed; the wind leans them over.
    p.vx += (airAt(world, p.x, p.y) - p.vx) * follow(dt, 0.15)
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "meteor":
    p.x += p.vx * dt
    p.y += p.vy * dt
    break
  case "smoke":
    // Warm exhaust: rises, slows, spreads and thins out, carried by the air.
    var kk = follow(dt, 0.6)
    p.vx += (airAt(world, p.x, p.y) * 0.8 - p.vx) * kk
    p.vy += (-26 - p.vy) * kk
    p.r = p.r0 + (p.r1 - p.r0) * Math.sqrt(p.age / p.life)
    p.x += p.vx * dt
    p.y += p.vy * dt
    return p.y > -60
  }

  if (p.y > world.height + 40 || p.x < -240 || p.x > world.width + 240) return false

  var hit = collide(world, x0, y0, p.x, p.y)
  if (!hit) return true
  return land(world, p, hit)
}

// Leaves and petals fall like paper: they swing from side to side, sink
// fastest through the middle of each swing, slow (and barely rise) at the
// ends, and tilt with the swing. Gusts and the pointer's wake carry them.
function stepFlutter(world, p, dt, pointer) {
  p.phase += dt * p.freq * 2
  var swing = Math.cos(p.phase)
  var air = airAt(world, p.x, p.y) * (p.kind === "leaf" ? 0.9 : 1.1)
  var wake = pointerWake(pointer, p.x, p.y, 130)
  var tx = air + swing * p.sway + (wake ? wake.x * 1.6 : 0)
  var ty = p.vt * (0.25 + 1.05 * swing * swing) + (wake ? wake.y * 1.4 : 0)
  var k = follow(dt, p.kind === "leaf" ? 0.22 : 0.16)
  p.vx += (tx - p.vx) * k
  p.vy += (ty - p.vy) * k
  var targetAngle = p.tilt + Math.sin(p.phase) * 0.75 + (wake ? clamp(wake.x * 0.004, -1.5, 1.5) : 0)
  var before = p.angle
  p.angle += (targetAngle - p.angle) * follow(dt, 0.12)
  p.spin = (p.angle - before) / dt
  p.x += p.vx * dt
  p.y += p.vy * dt
}

function land(world, p, hit) {
  var s = hit.surface
  switch (p.kind) {
  case "flake":
    // A flake's volume, packed loosely, spread on the cell it hits.
    deposit(world, s, p.x, Math.PI * p.r * p.r * 0.22 / CELL, 0)
    return false
  case "powder":
    if (p.amount > 0) deposit(world, s, p.x, p.amount, clamp((p.vx - s.vx) * 0.2, -80, 80))
    return false
  case "clump":
    impact(world, p, s, hit.y)
    return false
  case "leaf":
  case "petal":
    p.rest = s.id
    p.ox = p.x - s.x
    // Keeps a little of its sideways speed and slides to a stop.
    p.slide = clamp(p.vx - s.vx, -90, 90) * 0.5
    p.vx = 0; p.vy = 0
    p.restAge = 0
    p.angle = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.3, 0.3)
    if (p.kind === "petal") p.restLeft = rand(TUNING.sakura.restMin, TUNING.sakura.restMax)
    p.life = p.age + 1e6
    return true
  case "drop":
    splash(world, p.x, hit.y, p.vx - s.vx)
    return false
  case "meteor":
    burst(world, p.x, hit.y, Math.floor(rand(12, 20)), [0, 1, 2])
    return false
  }
  return false
}

function release(p, s, vx, vy) {
  p.rest = null
  p.x = s.x + p.ox
  p.y = s.y - heightAt(s, p.x) - 2
  p.vx = vx + rand(-25, 25)
  p.vy = vy + rand(-30, 0)
  p.phase = rand(0, 6.28)
}

function stepResting(world, p, dt, pointer) {
  var s = world.surfaces[p.rest]
  if (!s) { p.rest = null; return true }
  p.restAge += dt
  if (p.slide) {
    var before = p.slide
    p.slide -= sign(p.slide) * 0.6 * G * dt
    if (sign(p.slide) !== sign(before)) p.slide = 0
    p.ox += p.slide * dt
    if (!s.ground && (p.ox < 0 || p.ox > s.w)) { release(p, s, s.vx + before, s.vy); return true }
  }
  p.x = s.x + p.ox
  p.y = s.y - heightAt(s, p.x) - 1
  if (p.kind === "petal") {
    p.restLeft -= dt
    if (p.restLeft <= 0) return false
  }
  // The window under it lurches harder than friction can hold, or drops
  // away: it comes off with the window's speed.
  if (!s.ground) {
    var geff = G - s.ay
    if (geff < G * 0.15 || Math.abs(s.ax) > 0.55 * geff) {
      release(p, s, s.vx, s.vy)
      return true
    }
  }
  // A strong gust lifts it now and then.
  var gust = airAt(world, p.x, p.y)
  if (Math.abs(gust) > 34 && Math.random() < dt * (Math.abs(gust) - 34) * 0.006) {
    release(p, s, s.vx + gust * 1.5, s.vy - rand(50, 130))
    return true
  }
  // A pointer sweeping through scatters it.
  if (pointer) {
    var dx = p.x - pointer.x, dy = p.y - pointer.y
    var speed = Math.hypot(pointer.vx || 0, pointer.vy || 0)
    if (speed > 160 && dx * dx + dy * dy < 55 * 55) {
      release(p, s, s.vx + (pointer.vx || 0) * 0.45 + (dx >= 0 ? 60 : -60), s.vy - rand(140, 280))
      p.y = s.y - heightAt(s, p.x) - 6
    }
  }
  return true
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
  var k = follow(dt, 0.55)
  p.vx += ((tx - p.x) * pull - p.vx) * k
  p.vy += ((ty - p.y) * pull - p.vy) * k
  var max = still ? 160 : 70
  var sp = Math.hypot(p.vx, p.vy)
  if (sp > max) { p.vx *= max / sp; p.vy *= max / sp }
  p.x += p.vx * dt
  p.y += p.vy * dt
  // Keep them on screen: turn back softly at the edges.
  if (p.x < 10) { p.x = 10; p.vx = Math.abs(p.vx); p.heading = 0 }
  if (p.x > world.width - 10) { p.x = world.width - 10; p.vx = -Math.abs(p.vx); p.heading = Math.PI }
  if (p.y < world.height * 0.1) { p.y = world.height * 0.1; p.vy = Math.abs(p.vy); p.heading = Math.PI / 2 }
  if (p.y > groundY(world) - 6) { p.y = groundY(world) - 6; p.vy = -Math.abs(p.vy); p.heading = -Math.PI / 2 }
}

// Leaves pile up but never without limit: the oldest resting ones go.
function capResting(world) {
  var cap = TUNING.leaves.restCap
  var resting = []
  for (var i = 0; i < world.particles.length; i++) {
    var p = world.particles[i]
    if (p.kind === "leaf" && p.rest) resting.push(p)
  }
  if (resting.length <= cap) return
  resting.sort(function(a, b) { return b.restAge - a.restAge })
  for (var j = 0; j < resting.length - cap; j++) resting[j].dead = true
  world.particles = world.particles.filter(function(p) { return !p.dead })
}

// ------------------------------------------------------------------ queries

// The top of the pile under x on a surface, for decorations that stand on
// windows or the ground.
function restingY(world, surfaceId, x) {
  var s = world.surfaces[surfaceId]
  if (!s) return null
  return s.y - heightAt(s, x)
}

// A surface's estimated motion, for decorations that sway when their window
// is dragged.
function surfaceMotion(world, surfaceId) {
  var s = world.surfaces[surfaceId]
  if (!s) return { vx: 0, vy: 0, ax: 0, ay: 0 }
  return { vx: s.vx, vy: s.vy, ax: s.ax, ay: s.ay }
}

// For tests and the status IPC.
// ------------------------------------------------------------------ the plow
//
// A bulldozer that clears the ground snow. It is part of the simulation:
// its blade scrapes the height field, what it scrapes up becomes a berm in
// front of the blade that slows it down, the berm's face sheds tumbling
// chunks that land ahead and get pushed again, snow curls over the blade
// top when the berm is full, and its cab roof is a surface like a window's,
// so snow settles on it and slides off when it pulls away. What it pushes
// past the screen edge is gone.

function plowScale(world) { return clamp(world.height / 1080, 0.8, 1.6) }

function groundFill(world) {
  var g = world.surfaces[GROUND_ID]
  if (!g || !g.bins.length) return 0
  var cap = TUNING.snow.groundCap, t = 0
  for (var i = 0; i < g.bins.length; i++) t += Math.min(1, g.bins[i] / cap)
  return t / g.bins.length
}

function setPlow(world, on) {
  world.plowEnabled = !!on
}

// Sends the plow out now if it is not already out. Returns whether it went.
function callPlow(world, dir) {
  if (world.plow) return false
  var k = plowScale(world)
  dir = dir === -1 || dir === 1 ? dir : world.plowDir
  world.plowDir = -dir
  // It drives in from beyond the edge with its blade up, at a walking pace.
  var start = dir > 0 ? -12 * k : world.width + 12 * k
  world.plow = {
    dir: dir, k: k,
    x: start,               // the blade's cutting edge
    v: PLOW.speed * k * 0.75,
    lift: 1,                // 0 blade on the ground .. 1 raised
    load: 0, scraped: 0, sideSpill: 0,
    bermH: 0, bermLen: 0, bermFlat: 0,
    tread: 0, pitch: 0, pitchV: 0, bob: 0,
    throttle: 0.6, age: 0, smokeDebt: 0, spillDebt: 0,
    done: false
  }
  world.plowRuns++
  return true
}

function plowRear(P) { return P.x - P.dir * PLOW.bodyLength * P.k }

function stepPlow(world, dt) {
  var P = world.plow
  if (!P) {
    world.plowCheck -= dt
    if (world.plowCheck > 0) return
    world.plowCheck = 0.5
    if (world.plowEnabled && world.effect === "snow" && world.time >= world.plowRest &&
        groundFill(world) >= PLOW.threshold) callPlow(world)
    return
  }
  var g = world.surfaces[GROUND_ID]
  var k = P.k, dir = P.dir
  var W = world.width
  P.age += dt

  // Where the blade is: entering, on the screen, or past the far edge.
  var edgeIn = dir > 0 ? P.x > 2 * k : P.x < W - 2 * k
  var pastEnd = dir > 0 ? P.x > W + 4 * k : P.x < -4 * k
  var liftTarget = !edgeIn ? 1 : (pastEnd ? 1 : 0)
  var dl = liftTarget - P.lift
  P.lift += clamp(dl, -PLOW.liftSpeed * dt, PLOW.liftSpeed * dt)

  // Speed: the berm's weight slows it; it eases off while lowering the blade.
  var share = Math.max(PLOW.minSpeedShare, 1 / (1 + P.load / PLOW.loadDrag))
  var target = PLOW.speed * k * share * (P.lift > 0.05 && P.lift < 0.95 ? 0.8 : 1)
  if (pastEnd) target = PLOW.speed * k * 1.15
  var before = P.v
  P.v += (target - P.v) * follow(dt, PLOW.accel)
  var accel = (P.v - before) / dt
  var x0 = P.x
  P.x += dir * P.v * dt
  P.tread += P.v * dt

  // The blade scrapes every cell its edge has passed and its body covers.
  // Raised part-way, it only shaves the snow above its edge.
  var bladeH = PLOW.bladeHeight * k
  var floor = P.lift * bladeH * 0.9
  if (g && P.lift < 0.98) {
    var n = g.bins.length
    var a = dir > 0 ? Math.min(x0, P.x) - PLOW.bodyLength * k : P.x
    var b = dir > 0 ? P.x : Math.max(x0, P.x) + PLOW.bodyLength * k
    var i0 = clamp(Math.floor((a - g.x) / CELL), 0, n - 1)
    var i1 = clamp(Math.ceil((b - g.x) / CELL), 0, n - 1)
    for (var i = i0; i <= i1; i++) {
      var cx = g.x + (i + 0.5) * CELL
      var behind = dir > 0 ? cx <= P.x : cx >= P.x
      if (!behind) continue
      var take = g.bins[i] - floor
      if (take <= 0) continue
      g.bins[i] -= take
      g.slip[i] = 0
      P.load += take
      P.scraped += take
    }
  }

  // Past the edge, what is in front of the blade leaves with it.
  if (pastEnd) P.load = Math.max(0, P.load - P.load * follow(dt, 0.6))

  // The berm: a mound heaped against the blade, about 2.4 times as long as
  // it is tall, up to well over the blade's top. Past that the blade
  // carries no more: the extra spills off its ends, out of the picture.
  var area = P.load * CELL
  var shapeArea = 0.62 * 2.4               // area of the mound per H² (its profile)
  var maxH = bladeH * PLOW.bermMax
  var tall = Math.sqrt(area / shapeArea)
  if (tall > maxH) {
    var over = (area - shapeArea * maxH * maxH) / CELL
    P.load -= over
    P.sideSpill += over
    tall = maxH
  }
  P.bermH = tall
  P.bermLen = tall * 2.4
  P.bermFlat = 0
  var capH = bladeH * 0.98
  var gy = groundY(world)
  // Snow tumbles down the berm's face and is pushed again where it lands,
  // the faster and the fuller the more.
  if (P.bermH > 3 * k && P.v > 8 && world.particles.length < maxParticles(world)) {
    P.spillDebt += dt * (P.v / (PLOW.speed * k)) * (P.bermH / bladeH) * 7
    while (P.spillDebt >= 1 && P.load > 1) {
      P.spillDebt -= 1
      var m = Math.min(P.load * 0.08, rand(0.5, 1.8))
      P.load -= m
      var u = rand(0.15, 0.85)
      var sx = P.x + dir * P.bermLen * (0.15 + (1 - u) * 0.6)
      world.particles.push({
        kind: "clump", x: sx, y: gy - P.bermH * u - 1,
        vx: dir * (P.v + rand(15, 60)), vy: -rand(20, 110),
        r: chunkRadius(m), amount: m, pack: 0.75,
        angle: rand(0, 6.28), spin: dir * rand(4, 10), life: 6, age: 0, rest: null
      })
    }
    // A berm over the blade's top: snow curls over it and puffs off.
    if (P.bermH >= capH && Math.random() < dt * 14 * (P.bermH / maxH)) {
      addPowder(world, P.x + dir * rand(0, 8) * k, gy - P.bermH - rand(0, 3), dir * (P.v + rand(20, 80)), -rand(50, 130), 0)
    }
  } else P.spillDebt = 0

  // Body motion: the nose dips as the berm pushes back and on braking, and
  // the engine shakes it a little.
  var pitchTarget = clamp(-accel / G * 0.6 + P.load * 0.00002 - (1 - P.lift) * 0.003, -0.02, 0.018)
  P.pitchV += ((pitchTarget - P.pitch) * 60 - P.pitchV * 9) * dt
  P.pitch += P.pitchV * dt
  P.throttle += (clamp(0.35 + Math.max(0, accel) / 200 + P.load / 400, 0.3, 1) - P.throttle) * follow(dt, 0.3)
  P.bob = Math.sin(world.time * 47) * 0.35 * k * P.throttle + Math.sin(P.tread / (7 * k) * Math.PI * 2) * 0.25 * k

  // Exhaust: a steady trickle, thicker under load.
  P.smokeDebt += dt * (5 + 16 * P.throttle)
  var stackX = P.x + dir * PLOW.stack.x * k
  var stackY = gy + PLOW.stack.y * k + P.bob
  while (P.smokeDebt >= 1) {
    P.smokeDebt -= 1
    if (world.particles.length > maxParticles(world) * 1.2) break
    var life = rand(1.4, 2.6)
    world.particles.push({
      kind: "smoke", x: stackX + rand(-1, 1) * k, y: stackY,
      vx: -dir * P.v * 0.25 + rand(-10, 10), vy: -rand(70, 120) * (0.6 + P.throttle * 0.6),
      r0: 2 * k, r1: rand(7, 12) * k, r: 2.2 * k,
      shade: P.throttle, life: life, age: 0, rest: null
    })
  }

  // The cab roof: a surface like a window's top, so snow lands on it.
  var roofX = P.x + dir * PLOW.roof.back * k - (dir < 0 ? PLOW.roof.length * k : 0)
  var rect = { id: PLOW_ID, x: roofX, y: gy - PLOW.roof.height * k + P.bob, w: PLOW.roof.length * k, h: 40 * k }
  var roof = world.surfaces[PLOW_ID]
  if (!roof) {
    roof = makeSurface(PLOW_ID, rect.x, rect.y, rect.w, false)
    roof.h = rect.h
    roof.floating = true
    roof.z = -1e9
    roof.plow = true
    roof.sampleT = world.time
    world.surfaces[PLOW_ID] = roof
    rebuildOrder(world)
  } else {
    track(world, roof, rect, world.time)
  }

  // Gone past the far edge: done until the snow builds up again.
  var rear = plowRear(P)
  if (dir > 0 ? rear > W + 30 * k : rear < -30 * k) {
    var r = world.surfaces[PLOW_ID]
    if (r) { delete world.surfaces[PLOW_ID]; spill(world, r); rebuildOrder(world) }
    world.plow = null
    world.plowRest = world.time + PLOW.rest
  }
}

function stats(world) {
  var counts = {}
  for (var i = 0; i < world.particles.length; i++) {
    var k = world.particles[i].kind
    counts[k] = (counts[k] || 0) + 1
  }
  var sliding = 0
  for (var id in world.surfaces) if (world.surfaces[id].sliding) sliding++
  return { effect: world.effect, particles: world.particles.length, kinds: counts,
           surfaces: world.order.length - (world.surfaces[PLOW_ID] ? 1 : 0), snow: Math.round(totalSnow(world)), sliding: sliding,
           plow: world.plow ? { x: Math.round(world.plow.x), load: Math.round(world.plow.load), lift: +world.plow.lift.toFixed(2) } : null,
           groundFill: +groundFill(world).toFixed(3), plowRuns: world.plowRuns }
}
