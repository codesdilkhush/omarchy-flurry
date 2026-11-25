// A dragged window's snow is painted where the compositor shows the window,
// though the shell reads windows a poll (and a few frames) late: the line
// that used to trail a dragged window. The physics are untouched.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const S = load("lib/sim.js"), D = load("lib/draw.js")
const dt = 1 / 60

function run(LAG, poll) {
  const term = { id: "t", x: 420, y: 420, w: 900, h: 460, floating: true, z: 0 }
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 1, plow: false })
  const grab = { x: 400, y: 14 }
  const on = (r, vx, vy, still) => ({ x: r.x + grab.x, y: r.y + grab.y, vx, vy, present: true, stillFor: still, age: dt })
  const rest = on(term, 0, 0, 2)
  for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [term], w.time, [term.id], { pointer: rest, poll: 0.2, layoutAge: 30 }); S.step(w, dt, { pointer: rest }) }
  const path = t => t < 0.5 ? { x: -700 * t, y: -260 * t } : t < 1.25 ? { x: -350 + 900 * (t - 0.5), y: -130 + 420 * (t - 0.5) } : { x: 325, y: 185 }
  const hist = [], pf = Math.max(1, Math.round(poll / dt))
  let before = 0, after = 0, n = 0
  for (let f = 0; f <= 110; f++) {
    const p = path(f * dt), shown = { ...term, x: term.x + p.x, y: term.y + p.y }
    hist.push(shown)
    const c0 = hist[Math.max(0, hist.length - 2)], c1 = hist[Math.max(0, hist.length - 3)]
    const ptr = on(c0, (c0.x - c1.x) / dt, (c0.y - c1.y) / dt, c0.x === c1.x && c0.y === c1.y ? 1 : 0)
    if (f % pf === 0) S.setSurfaces(w, [hist[Math.max(0, hist.length - 1 - LAG)]], w.time, [term.id], { pointer: ptr, poll, layoutAge: 30 })
    S.step(w, dt, { pointer: ptr })
    const s = w.surfaces.t, ld = D.leadOf(w, s) || { x: 0, y: 0 }
    before += Math.hypot(s.x - shown.x, s.y - shown.y)
    after += Math.hypot(s.x + ld.x - shown.x, s.y + ld.y - shown.y)
    n++
  }
  return { before: before / n, after: after / n, w }
}

for (const [LAG, poll] of [[1, 0.016], [3, 0.016], [3, 0.05], [6, 0.016]]) {
  test(`a dragged window's snow is painted on it (shell ${LAG} frames late, ${poll * 1000} ms poll)`, () => {
    const r = run(LAG, poll)
    // DRAW_LAG adds one frame for the compositor, which this harness does not model.
    assert.ok(r.after < r.before * 0.6 + 14, `mean gap ${r.after.toFixed(1)}px vs ${r.before.toFixed(1)}px unpainted`)
  })
}

test("a window at rest is painted where it is", () => {
  const r = run(3, 0.016)
  const s = r.w.surfaces.t
  for (let i = 0; i < 30; i++) S.step(r.w, dt, { pointer: { x: s.x + 400, y: s.y + 14, vx: 0, vy: 0, present: true, stillFor: 1, age: dt } })
  assert.strictEqual(D.leadOf(r.w, s), null)
})

test("a sudden pull up never sinks a window's snow into it, from the first sample on", () => {
  const term = { id: "t", x: 420, y: 420, w: 900, h: 460, floating: true, z: 0 }
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 1, plow: false })
  const grab = { x: 400, y: 200 }
  const on = (r, vx, vy, still) => ({ x: r.x + grab.x, y: r.y + grab.y, vx, vy, present: true, stillFor: still, age: dt })
  const rest = on(term, 0, 0, 2)
  for (let t = 0; t < 3; t += dt) { S.setSurfaces(w, [term], w.time, [term.id], { pointer: rest, poll: 0.2, layoutAge: 30 }); S.step(w, dt, { pointer: rest }) }
  const LAG = 4, hist = []
  let worst = 0, armed = false
  for (let f = 0; f <= 40; f++) {
    const y = f * dt < 0.18 ? -1800 * f * dt : -324
    const shown = { ...term, y: term.y + y }
    hist.push(shown)
    const c0 = hist[Math.max(0, hist.length - 2)], c1 = hist[Math.max(0, hist.length - 3)]
    const ptr = on(c0, 0, (c0.y - c1.y) / dt, c0.y === c1.y ? 1 : 0)
    S.setSurfaces(w, [hist[Math.max(0, hist.length - 1 - LAG)]], w.time, [term.id], { pointer: ptr, poll: 0.016, layoutAge: 30 })
    S.step(w, dt, { pointer: ptr })
    const s = w.surfaces.t
    if (s.dragT !== undefined) armed = true
    if (!armed) continue
    const ld = D.leadOf(w, s) || { x: 0, y: 0 }
    const sunk = (s.y + ld.y) - shown.y        // > 0: painted inside the window
    worst = Math.max(worst, sunk)
  }
  assert.ok(armed, "the pull was taken as a drag")
  assert.ok(worst < 16, `snow sank ${worst.toFixed(1)} px into the window`)
})
