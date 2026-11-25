// A deterministic model of the shell around one dragged window, as on a
// real Hyprland desktop, for the window-attachment regression tests and
// the frame renders:
//
//   * The compositor moves a dragged window rigidly with the pointer:
//     shown(t) = pointer(t) + grab. It shows each overlay frame one frame
//     after it is painted.
//   * The shell reads the pointer every frame (a few ms old) and the window
//     list every frame, but a window reading reaches the world `delay`
//     seconds after the compositor had the window there (the poll, the
//     socket round trip, the JSON).
//   * Optionally the pointer feed also brings the focused window's rectangle
//     from the same compositor instant (the cursorpos + activewindow batch,
//     see Service.qml): `snapshot: true`.
//
// path(t) gives the pointer's offset from where the drag started; the
// window follows it exactly while `held(t)` (default: always).
"use strict"
const load = require("./load")

function makeHarness(opts) {
  const S = opts.S || load("lib/sim.js"), D = opts.D || load("lib/draw.js")
  const dt = 1 / 60
  const W = opts.width || 1920, H = opts.height || 1080
  const base = Object.assign({ id: "0xa", x: 420, y: 300, w: 900, h: 460, floating: true, z: 0 }, opts.window || {})
  const others = opts.others || []
  const grab = opts.grab || { x: 400, y: 14 }
  const delay = opts.delay === undefined ? 0.03 : opts.delay
  const ptrAge = opts.ptrAge === undefined ? 0.004 : opts.ptrAge
  const held = opts.held || (() => true)
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  if (opts.icicles) S.setFeatures(w, { icicles: true, border: 2 })
  let winOff = { x: 0, y: 0 }            // window's offset from base while not held
  const hist = []                        // [{ t, x, y }] window as the compositor had it
  // Where the compositor has the window at time t: with the pointer while
  // held, else where it was let go (continuous, not frame by frame: the
  // compositor places the window as the pointer moves).
  function winAt(t) {
    let lastHeld = -1
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= t + 1e-9) { if (hist[i].held) { lastHeld = i }; break }
    if (held(Math.max(0, t))) { const p = ptrAt(t); return { t, x: p.x - grab.x, y: p.y - grab.y } }
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= t + 1e-9) return hist[i]
    return { t: 0, x: base.x, y: base.y }
  }
  const P = opts.P || load("lib/policy.js")
  let lastPtr = null, lastPtrT = 0, still = 2, sv = { vx: 0, vy: 0 }, lastSig = "", listT = -1
  const ptrAt = t => { const p = opts.path(Math.max(0, t)); return { x: base.x + grab.x + p.x, y: base.y + grab.y + p.y } }
  function settle(seconds, fill) {
    const rest = { x: base.x + grab.x, y: base.y + grab.y, vx: 0, vy: 0, present: true, stillFor: 2, age: 0 }
    for (let t = 0; t < seconds; t += dt) {
      S.setSurfaces(w, [base, ...others], w.time, [base.id, ...others.map(o => o.id)], { pointer: rest, poll: 0.2, layoutAge: 30 })
      S.step(w, dt, { pointer: rest })
    }
    if (fill) for (const id in w.surfaces) { const s = w.surfaces[id]; if (!s.ground) for (let i = 0; i < s.bins.length; i++) s.bins[i] = fill }
  }
  const frames = []
  function run(seconds, sample) {
    const t0 = w.time
    for (let f = 0; f * dt < seconds; f++) {
      const t = f * dt
      // The compositor this frame.
      const p = ptrAt(t)
      if (held(t)) winOff = { x: p.x - grab.x - base.x, y: p.y - grab.y - base.y }
      hist.push({ t, x: base.x + winOff.x, y: base.y + winOff.y, held: held(t) })
      // The shell's pointer reading (as Service.takePointer keeps it).
      const pr = ptrAt(t - ptrAge)
      const pdt = lastPtr ? dt : 0.05
      const moved = !lastPtr || Math.abs(pr.x - lastPtr.x) + Math.abs(pr.y - lastPtr.y) > 2
      still = moved ? 0 : still + pdt
      const vx = lastPtr ? (pr.x - lastPtr.x) / pdt : 0, vy = lastPtr ? (pr.y - lastPtr.y) / pdt : 0
      sv = { vx: sv.vx * 0.4 + vx * 0.6, vy: sv.vy * 0.4 + vy * 0.6 }
      lastPtr = pr; lastPtrT = t
      const ptr = { x: pr.x, y: pr.y, vx: sv.vx, vy: sv.vy, present: true, stillFor: still, age: ptrAge }
      // The window list as the shell has it: `delay` old.
      // A reading is never older than the one before it.
      const d = typeof delay === "function" ? delay(t) : delay
      listT = Math.max(listT, t - d)
      const seen = winAt(listT)
      let rects = [{ ...base, x: Math.round(seen.x), y: Math.round(seen.y) }, ...others]
      if (opts.snapshot) {
        // As SceneWindow.syncWindows: the focused window from the snapshot
        // taken with the pointer reading, the rest from the list; the
        // world hears only of changes, and of a fresh snapshot that shows
        // the window still.
        const at = winAt(t - ptrAge), nowMs = 1e6 + t * 1000
        // The snapshot's own stamp: by default its true age; `seenAge` sets
        // what the shell believes it to be (a real shell stamps a reply
        // when it arrives, so it never sees the socket's own delay).
        const snap = { id: base.id, x: Math.round(at.x), y: Math.round(at.y), w: base.w, h: base.h, at: nowMs - (opts.seenAge === undefined ? ptrAge : opts.seenAge) * 1000 }
        rects = P.withSnapshot(rects, snap, nowMs, 0, 0, nowMs - (t - listT) * 1000, 150)
        const sig = rects.map(r => [r.id, r.x, r.y, r.w, r.h].join(",")).join(";")
        if (sig !== lastSig) {
          lastSig = sig
          S.setSurfaces(w, rects, w.time, rects.map(r => r.id), { pointer: ptr, poll: dt, layoutAge: 30 })
        }
        S.noteStill(w, [snap.id])
      } else S.setSurfaces(w, rects, w.time, rects.map(r => r.id), { pointer: ptr, poll: dt, layoutAge: 30 })
      S.step(w, dt, { pointer: ptr, readAgo: 0 })
      // Where the overlay paints the window's snow this frame, and where
      // the compositor has the window when that frame shows.
      const s = w.surfaces[base.id]
      const pl = D.placeOf ? D.placeOf(w, s) : (() => { const ld = D.leadOf(w, s); return { x: s.x + (ld ? ld.x : 0), y: s.y + (ld ? ld.y : 0) } })()
      const shown = winAt(t + dt)
      const fr = { t: w.time - t0, painted: pl, shown: { x: shown.x, y: shown.y, w: base.w, h: base.h }, ex: pl.x - shown.x, ey: pl.y - shown.y }
      frames.push(fr)
      if (sample) sample(fr, w, s)
    }
    return frames
  }
  return { S, D, w, base, grab, settle, run, frames, winAt }
}

// A window list that answers late, and later still now and then (the shell
// busy painting, the compositor busy dragging): seeded, so every run is the
// same.
function jitteryDelay(seed, lo, hi) {
  let x = seed >>> 0
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296 }
  const cache = new Map()
  return t => {
    const k = Math.round(t * 60)
    if (!cache.has(k)) cache.set(k, rnd() < 0.25 ? lo + (hi - lo) * rnd() : lo + (hi - lo) * 0.15 * rnd())
    return cache.get(k)
  }
}

// A hand shaking a window: quick strokes with short holds at the turns,
// the way a hand stops for a moment before it pulls back.
function shakePath(opts) {
  const o = Object.assign({ start: 0.2, strokes: 10, amp: 180, stroke: 0.11, hold: 0.07, ax: 1, ay: 0.6 }, opts || {})
  const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)
  return t => {
    if (t < o.start) return { x: 0, y: 0 }
    const per = o.stroke + o.hold, k = Math.floor((t - o.start) / per)
    if (k >= o.strokes) { const e = o.strokes % 2 ? o.amp : 0; return { x: e * o.ax, y: e * o.ay } }
    const u = ((t - o.start) - k * per) / o.stroke
    const from = k % 2 ? o.amp : 0, to = k % 2 ? 0 : o.amp
    const v = from + (to - from) * ease(u)
    return { x: v * o.ax, y: v * o.ay }
  }
}

module.exports = { makeHarness, shakePath, jitteryDelay }
