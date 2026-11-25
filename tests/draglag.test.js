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

// Jerked up and down, as in the user's recording: the compositor moves the
// window with the pointer every frame; the shell reads the pointer every
// frame (a little old), the windows every frame but a couple of frames
// late, and what is painted shows a frame later.
function jerk(scen) {
  const base = { id: "t", x: 420, y: 300, w: 900, h: 460, floating: true, z: 0 }, grab = { x: 400, y: 200 }
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 1, plow: false })
  let last = null, lastT = -1, stillFor = 2, smooth = null
  const out = []
  for (let f = 0; f < scen.frames; f++) {
    const t = f * dt, pt = scen.ptr(t - 0.004)
    const pdt = last ? t - lastT : 0.05
    const moved = !last || Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y) > 2
    stillFor = moved ? 0 : stillFor + pdt
    const vx = last ? (pt.x - last.x) / pdt : 0, vy = last ? (pt.y - last.y) / pdt : 0
    smooth = { vx: smooth ? smooth.vx * 0.4 + vx * 0.6 : 0, vy: smooth ? smooth.vy * 0.4 + vy * 0.6 : 0 }
    last = pt; lastT = t
    const ptr = { x: base.x + grab.x + pt.x, y: base.y + grab.y + pt.y, vx: smooth.vx, vy: smooth.vy, present: true, stillFor, age: 0.004 }
    const seen = scen.win(t - 0.03)
    S.setSurfaces(w, [{ ...base, x: Math.round(base.x + seen.x), y: Math.round(base.y + seen.y) }], w.time, [base.id], { pointer: ptr, poll: dt, layoutAge: 30 })
    S.step(w, dt, { pointer: ptr, readAgo: 0 })
    const s = w.surfaces.t, ld = D.leadOf(w, s) || { x: 0, y: 0 }
    const off = s.y + ld.y - (base.y + scen.win(t + dt).y)
    out.push({ t, gap: Math.abs(off), sunk: off, ph: scen.phase(t) })
  }
  return out
}
const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)

test("a window jerked up and down keeps its snow on its top edge, with no line between them", () => {
  const dy = t => t < 0.4 ? 0 : t < 1.73 ? -100 * Math.sin((t - 0.4) * 6 * Math.PI) * Math.min(1, (t - 0.4) * 8) : 0
  const r = jerk({ frames: 100, win: t => ({ x: 0, y: dy(t) }), ptr: t => ({ x: 0, y: dy(t) }), phase: t => t > 0.6 && t < 1.7 ? "shake" : "" })
  const sh = r.filter(q => q.ph === "shake"), mean = sh.reduce((a, q) => a + q.gap, 0) / sh.length
  assert.ok(mean < 11, `mean gap ${mean.toFixed(1)} px while shaken`)
})

test("pulled down steadily, the snow keeps right on the window's top", () => {
  const dy = t => t < 0.3 ? 0 : 160 * ease((t - 0.3) / 0.5)
  const r = jerk({ frames: 70, win: t => ({ x: 0, y: dy(t) }), ptr: t => ({ x: 0, y: dy(t) }), phase: t => t > 0.42 && t < 0.8 ? "down" : "" })
  const d = r.filter(q => q.ph === "down")
  assert.ok(Math.max(...d.map(q => q.gap)) < 4, `worst ${Math.max(...d.map(q => q.gap)).toFixed(1)} px`)
})

test("let go while the pointer flies on: the snow stays with the window after a frame or two", () => {
  const dy = t => t < 0.3 ? 0 : -220 * ease((t - 0.3) / 0.25)
  const ptrDy = t => t < 0.55 ? dy(t) : -220 - 80 * ease((t - 0.55) / 0.15)
  const r = jerk({ frames: 70, win: t => ({ x: 0, y: dy(t) }), ptr: t => ({ x: 0, y: ptrDy(t) }), phase: t => t > 0.65 ? "after" : "" })
  const a = r.filter(q => q.ph === "after")
  assert.ok(a.every(q => q.gap < 1), `still ${Math.max(...a.map(q => q.gap)).toFixed(1)} px off`)
})

test("jerked up and down, the snow never sinks into the window's top on the way up", () => {
  const dy = t => t < 0.4 ? 0 : t < 1.73 ? -100 * Math.sin((t - 0.4) * 6 * Math.PI) * Math.min(1, (t - 0.4) * 8) : 0
  const r = jerk({ frames: 100, win: t => ({ x: 0, y: dy(t) }), ptr: t => ({ x: 0, y: dy(t) }), phase: t => t > 0.6 && t < 1.7 ? "shake" : "" })
  const worst = Math.max(...r.filter(q => q.ph === "shake").map(q => q.sunk))
  assert.ok(worst < 8, `sank ${worst.toFixed(1)} px into the window`)
})

test("held still mid-drag, then pulled up: the snow goes up with it, not into it", () => {
  const dy = t => t < 0.3 ? 0 : t < 0.7 ? 150 * ease((t - 0.3) / 0.4) : t < 1.1 ? 150 : 150 - 300 * ease((t - 1.1) / 0.25)
  const r = jerk({ frames: 100, win: t => ({ x: 0, y: dy(t) }), ptr: t => ({ x: 0, y: dy(t) }), phase: t => t > 1.1 + 2.5 / 60 && t < 1.5 ? "yank" : "" })
  const worst = Math.max(...r.filter(q => q.ph === "yank").map(q => q.sunk))
  assert.ok(worst < 10, `sank ${worst.toFixed(1)} px into the window`)
})

// Hyprland says nothing when a drag is let go, so this costs a frame or two
// of the snow lifted with the pointer: the price of it never sinking into a
// held window pulled up (above).
test("let go, then the pointer moves off upward: the snow is back on the still window within two frames", () => {
  const dy = t => t < 0.3 ? 0 : t < 0.7 ? 150 * ease((t - 0.3) / 0.4) : 150
  const ptrDy = t => t < 1.1 ? dy(t) : 150 - 400 * ease((t - 1.1) / 0.3)
  const r = jerk({ frames: 100, win: t => ({ x: 0, y: dy(t) }), ptr: t => ({ x: 0, y: ptrDy(t) }), phase: t => t > 1.1 ? "after" : "" })
  const a = r.filter(q => q.ph === "after")
  assert.ok(a.filter(q => q.gap > 0.5).length <= 2, `lifted for ${a.filter(q => q.gap > 0.5).length} frames`)
  assert.ok(Math.max(...a.map(q => q.gap)) < 30, `lifted ${Math.max(...a.map(q => q.gap)).toFixed(1)} px`)
  })
