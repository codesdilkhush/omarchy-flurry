const test = require("node:test")
const assert = require("node:assert")
const S = require("./load")("lib/sim.js")

function run(world, seconds, rects, pointer) {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    if (rects) S.setSurfaces(world, rects, world.time)
    S.step(world, dt, { pointer })
  }
}

test("snow piles up on an exposed window top and the ground", () => {
  const w = S.createWorld(1200, 800, { effect: "snow", intensity: 2 })
  const rects = [{ id: "a", x: 200, y: 300, w: 600, h: 400, floating: false, z: 0 }]
  run(w, 40, rects)
  const a = w.surfaces.a.bins.reduce((x, y) => x + y, 0)
  const g = w.surfaces.__ground.bins.reduce((x, y) => x + y, 0)
  assert.ok(a > 50, "window collected snow: " + a)
  assert.ok(g > 50, "ground collected snow: " + g)
  assert.ok(Math.max(...w.surfaces.a.bins) <= S.TUNING.snow.cap + 1e-6)
})

test("a covered top edge collects nothing under the front window", () => {
  const w = S.createWorld(1000, 800, { effect: "snow", intensity: 2 })
  const rects = [
    { id: "back", x: 100, y: 300, w: 800, h: 300, floating: false, z: 3 },
    { id: "front", x: 50, y: 200, w: 900, h: 500, floating: true, z: 0 }
  ]
  run(w, 30, rects)
  assert.strictEqual(w.surfaces.back.bins.reduce((x, y) => x + y, 0), 0)
  assert.ok(w.surfaces.front.bins.reduce((x, y) => x + y, 0) > 10)
})

// A snowy floating window with the snow switched off, so only the physics
// moves snow around.
function snowyWindow() {
  const w = S.createWorld(1600, 1000, { effect: "snow", intensity: 2 })
  const r = { id: "a", x: 400, y: 400, w: 600, h: 400, floating: true, z: 0 }
  run(w, 40, [r])
  S.setEffect(w, "fireflies")
  return { w, r }
}

// Moves the window along offset(t) -> [dx, dy], sampling every frame as the
// shell does while something is moving.
function move(w, r, seconds, offset) {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    const [dx, dy] = offset(t)
    S.setSurfaces(w, [Object.assign({}, r, { x: r.x + dx, y: r.y + (dy || 0) })], w.time)
    S.step(w, dt)
  }
}

const sum = a => a.reduce((x, y) => x + y, 0)
const onWindow = w => sum(w.surfaces.a.bins) + w.surfaces.a.edges[0].m + w.surfaces.a.edges[1].m

test("a slow, steady drag keeps the snow on the window", () => {
  const { w, r } = snowyWindow()
  const before = onWindow(w)
  // Eases up to 120 px/s and back over two seconds.
  move(w, r, 2.2, t => { const u = Math.min(t / 2, 1); return [240 * u * u * (3 - 2 * u)] })
  assert.ok(onWindow(w) > before * 0.85, `kept ${onWindow(w)} of ${before}`)
})

test("a fling slides the snow off the trailing edge and it falls", () => {
  const { w, r } = snowyWindow()
  const before = onWindow(w)
  move(w, r, 0.5, t => [Math.min(t, 0.15) / 0.15 * 300])
  assert.ok(onWindow(w) < before * 0.75, `kept ${onWindow(w)} of ${before}`)
  const left = w.particles.filter(p => p.kind === "clump" && p.x < w.surfaces.a.x)
  assert.ok(left.length > 0, "snow left behind the moving window")
})

test("a hard stop throws the snow forward", () => {
  const { w, r } = snowyWindow()
  // Glides right at 700 px/s, gently enough to hold on, then stops dead.
  move(w, r, 1.2, t => [t < 0.6 ? 700 * t * t / 1.2 * 2 / 1 : 0].map(x => Math.min(x, 420)))
  const right = w.particles.filter(p => p.kind === "clump" && p.x > w.surfaces.a.x + w.surfaces.a.w)
  assert.ok(right.length > 0, "chunks went over the leading edge")
})

test("a window yanked downward faster than gravity leaves its snow in the air", () => {
  const { w, r } = snowyWindow()
  move(w, r, 0.12, t => [0, 0.5 * 5000 * t * t])
  assert.ok(sum(w.surfaces.a.bins) < 1, "snow lifted off")
  assert.ok(w.particles.some(p => p.kind === "clump"))
})

test("sliding conserves snow", () => {
  const { w, r } = snowyWindow()
  const airborne = () => w.particles.reduce((a, p) => a + (p.kind === "clump" || p.kind === "powder" ? p.amount : 0), 0)
  const total = () => S.totalSnow(w) + airborne()
  const before = total()
  // Shake without melting: compare over a short window.
  move(w, r, 0.6, t => [40 * Math.sin(t * 30)])
  const after = total()
  // Melting (non-snow effect) and dust that fades take a little.
  assert.ok(after > before * 0.9 && after < before * 1.001, `${after} vs ${before}`)
})

test("piles slump to their angle of repose", () => {
  const w = S.createWorld(800, 600, { effect: "snow" })
  S.setSurfaces(w, [{ id: "a", x: 100, y: 300, w: 400, h: 200 }], 0)
  S.setEffect(w, "fireflies")
  const s = w.surfaces.a
  s.bins[50] = 14
  for (let i = 0; i < 120; i++) S.step(w, 1 / 60)
  let steepest = 0
  for (let i = 0; i + 1 < s.bins.length; i++) steepest = Math.max(steepest, Math.abs(s.bins[i] - s.bins[i + 1]))
  assert.ok(steepest <= S.SNOW.repose[1] * S.CELL + 0.2, "steepest step " + steepest)
  assert.ok(s.bins[49] > 1 && s.bins[51] > 1, "spread to the neighbours")
})

test("a chunk hitting hard breaks up", () => {
  const w = S.createWorld(800, 600, { effect: "fireflies" })
  w.particles.push({ kind: "clump", x: 400, y: 580, vx: 0, vy: 900, r: 3, amount: 4, pack: 0.2, angle: 0, spin: 0, life: 5, age: 0, rest: null })
  for (let i = 0; i < 6; i++) S.step(w, 1 / 60)
  assert.ok(w.particles.some(p => p.kind === "powder" || p.kind === "clump"), "pieces flew")
  assert.ok(S.totalSnow(w) > 2, "most of it stayed")
})

test("snow waits for a window on another workspace", () => {
  const { w, r } = snowyWindow()
  const before = sum(w.surfaces.a.bins)
  const clumps = () => w.particles.filter(p => p.kind === "clump").length
  const had = clumps()
  S.setSurfaces(w, [], w.time, ["a"])
  assert.strictEqual(clumps(), had, "nothing spilled")
  S.setSurfaces(w, [r], w.time, ["a"])
  assert.ok(sum(w.surfaces.a.bins) > before * 0.95)
})

test("resizing from the left keeps the snow where it lies", () => {
  const { w, r } = snowyWindow()
  const s = w.surfaces.a
  for (let i = 0; i < s.bins.length; i++) s.bins[i] = i === 100 ? 9 : 0
  const x = s.x + 100.5 * S.CELL
  S.setSurfaces(w, [Object.assign({}, r, { x: r.x + 80, w: r.w - 80 })], w.time)
  assert.ok(S.restingY(w, "a", x) < r.y - 8, "the heap stayed put on screen")
})

test("closing a window drops its snow", () => {
  const w = S.createWorld(1200, 800, { effect: "snow", intensity: 2 })
  run(w, 20, [{ id: "a", x: 200, y: 300, w: 600, h: 400 }])
  S.setSurfaces(w, [], w.time)
  assert.strictEqual(w.surfaces.a, undefined)
  assert.ok(w.particles.some(p => p.kind === "clump"))
})

test("leaves rest and a fast pointer scatters them", () => {
  const w = S.createWorld(800, 600, { effect: "leaves", intensity: 2 })
  run(w, 40, [])
  const resting = w.particles.filter(p => p.kind === "leaf" && p.rest)
  assert.ok(resting.length > 5, "leaves landed: " + resting.length)
  const leaf = resting[0]
  run(w, 0.05, [], { x: leaf.x, y: leaf.y, vx: 900, vy: 0, present: true, stillFor: 0 })
  assert.strictEqual(leaf.rest, null)
})

test("meteors burst into sparks and rain splashes", () => {
  const w = S.createWorld(800, 600, { effect: "starfall", intensity: 2 })
  run(w, 30, [])
  // Sparks are short-lived, so look for them during a run.
  let sparks = 0
  for (let i = 0; i < 600 && !sparks; i++) { S.step(w, 1 / 60, {}); sparks = w.particles.filter(p => p.kind === "spark").length }
  assert.ok(sparks > 0)
  S.setEffect(w, "rain")
  let splashes = 0
  for (let i = 0; i < 120 && !splashes; i++) { S.step(w, 1 / 60, {}); splashes = w.particles.filter(p => p.kind === "splash").length }
  assert.ok(splashes > 0)
})

test("fireflies gather around a still pointer", () => {
  const w = S.createWorld(1000, 800, { effect: "fireflies", intensity: 1 })
  const ptr = { x: 500, y: 400, vx: 0, vy: 0, present: true, stillFor: 5 }
  run(w, 12, [], ptr)
  const flies = w.particles.filter(p => p.kind === "firefly")
  const near = flies.filter(p => Math.hypot(p.x - 500, p.y - 400) < 160).length
  assert.ok(flies.length >= 10)
  assert.ok(near / flies.length > 0.7, `${near}/${flies.length} near`)
})

test("particle count stays bounded at max intensity", () => {
  const w = S.createWorld(3840, 2160, { effect: "rain", intensity: 2 })
  run(w, 10, [])
  assert.ok(w.particles.length <= S.maxParticles(w) * 1.6)
})

test("snow melts after switching effect", () => {
  const w = S.createWorld(800, 600, { effect: "snow", intensity: 2 })
  run(w, 20, [{ id: "a", x: 100, y: 200, w: 500, h: 300 }])
  const before = S.totalSnow(w)
  S.setEffect(w, "sakura")
  run(w, 60, [{ id: "a", x: 100, y: 200, w: 500, h: 300 }])
  assert.ok(S.totalSnow(w) < before * 0.2)
})
