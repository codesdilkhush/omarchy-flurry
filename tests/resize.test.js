// A window resized smaller under its snow (seen live in 1.2.4: the ledge
// stuck out past the shrinking edge and poured off it in an arc). The edge
// is cut a little ahead of the last sample, by how fast it is coming in, so
// nothing hangs past the window while it shrinks; what it no longer holds
// up falls straight down from where it lay. And the loose flow that evens
// out snow that has just come down in pieces keeps the mass exactly.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js")

const dt = 1 / 60
const BASE = { id: "0xr", x: 400, y: 200, w: 900, h: 400, floating: true, z: 0 }
const still = r => ({ pointer: { x: r.x + 300, y: r.y + 12, vx: 0, vy: 0, present: true, stillFor: 3 }, poll: 0.2, layoutAge: 60 })

function scene() {
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 1.4, plow: false })
  for (let t = 0; t < 60; t += dt) { S.setSurfaces(w, [BASE], w.time, [BASE.id], still(BASE)); S.step(w, dt) }
  S.setEnv(w, { snowScale: 0 }); w.particles = []
  return w
}
// The rightmost / leftmost x the window's snow reaches on screen, overhang included.
function reach(w) {
  const s = w.surfaces[BASE.id]
  let lo = Infinity, hi = -Infinity
  s.bins.forEach((b, i) => { if (b > 0.3) { lo = Math.min(lo, s.x + i * S.CELL); hi = Math.max(hi, s.x + (i + 1) * S.CELL) } })
  if (s.edges[0].m > 0.3) lo = s.x - 4
  if (s.edges[1].m > 0.3) hi = s.x + s.w + 4
  return { lo, hi }
}

for (const side of ["right", "left"]) {
  test(`shrinking from the ${side} at 1000 px/s: no snow past the window's edge, and it drops, it is not thrown`, () => {
    const w = scene()
    let worst = 0, first = 0, fastest = 0
    for (let t = 0; t < 1; t += dt) {
      const nw = Math.max(300, 900 - 1000 * t)
      const r = Object.assign({}, BASE, side === "right" ? { w: nw } : { x: BASE.x + 900 - nw, w: nw })
      S.setSurfaces(w, [r], w.time, [BASE.id], { pointer: { x: side === "right" ? r.x + nw : r.x, y: r.y + 200, vx: side === "right" ? -1000 : 1000, vy: 0, present: true, stillFor: 0 }, poll: 0.016, layoutAge: 60 })
      S.step(w, dt)
      // The compositor shows the window a frame ahead of this sample.
      const next = Math.max(300, 900 - 1000 * (t + dt))
      const edge = side === "right" ? BASE.x + next : BASE.x + 900 - next
      const rr = reach(w)
      const past = side === "right" ? rr.hi - edge : edge - rr.lo
      // The first sample of the resize follows a pause and has no speed to
      // go on yet; from the next one on it keeps ahead of the edge.
      if (t > dt * 1.5) worst = Math.max(worst, past)
      else first = Math.max(first, past)
      for (const p of w.particles) if (p.kind === "clump" && p.age < 0.3) fastest = Math.max(fastest, Math.abs(p.vx))
    }
    assert.ok(worst <= 4, `snow past the edge: ${worst.toFixed(1)} px`)
    assert.ok(first <= 18, `on the first sample: ${first.toFixed(1)} px`)
    assert.ok(fastest < 60, `fell straight down: fastest ${fastest.toFixed(0)} px/s sideways`)
  })
}

test("loose snow evens out into a lumpy ledge, mass kept exactly", () => {
  const w = S.createWorld(800, 600, { effect: "snow" })
  const s = S.makeSurface("x", 100, 200, 400, false)
  s.bins = s.bins.map((_, i) => (i % 6 < 2 ? 9 : 0.5))
  s.reflow = S.REFLOW.after
  const before = s.bins.reduce((a, b) => a + b, 0)
  let comb = 0
  for (let i = 1; i < s.bins.length; i++) comb = Math.max(comb, Math.abs(s.bins[i] - s.bins[i - 1]))
  for (let t = 0; t < 1; t += dt) S.reflow(s, dt)
  let steep = 0
  for (let i = 1; i < s.bins.length; i++) steep = Math.max(steep, Math.abs(s.bins[i] - s.bins[i - 1]))
  const after = s.bins.reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(after - before) < 1e-9, `mass ${after} of ${before}`)
  assert.ok(steep < comb * 0.35, `the comb flattened: ${steep.toFixed(2)} from ${comb.toFixed(2)}`)
  assert.ok(steep > 0.05, "but not flat")
  assert.ok(s.bins.every(b => b >= 0))
  assert.strictEqual(s.reflow, 0)
})

test("turned off mid-visit, Santa leaves at once instead of crossing an empty sky", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "SceneWindow.qml"), "utf8")
  assert.match(src, /onEffectOnChanged: if \(!effectOn && santa\.running\) \{ santa\.running = false; santa\.visible = false \}/)
})
