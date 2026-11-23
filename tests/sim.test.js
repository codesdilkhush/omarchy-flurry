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

test("flinging a window throws its snow off", () => {
  const w = S.createWorld(1200, 800, { effect: "snow", intensity: 2 })
  const r = { id: "a", x: 200, y: 300, w: 600, h: 400, floating: true, z: 0 }
  run(w, 30, [r])
  const before = w.surfaces.a.bins.reduce((x, y) => x + y, 0)
  w.running = true
  const moved = Object.assign({}, r, { x: 500 })
  S.setSurfaces(w, [moved], w.time + 0.1)
  const after = w.surfaces.a.bins.reduce((x, y) => x + y, 0)
  assert.ok(after < before * 0.2, `kept ${after} of ${before}`)
  assert.ok(w.particles.some(p => p.kind === "clump" && p.vx < 0), "clumps fly opposite the move")
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
