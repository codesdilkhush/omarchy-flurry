// Snow attached to a window stays on that window: the regression tests for
// strips of a shaken window's snow left behind it, lines across its face,
// and snow painted over what is in the windows (v1.5.1 and before).
//
// Root cause (see draw.js leadOf): a dragged window's snow was painted at
// the pointer plus an offset the simulation learnt from pointer and window
// readings of different ages, and the offset was locked for the rest of the
// drag. Whenever the window list answered late, as it does under load, the
// offset was wrong by however far the window had gone in the meantime, so
// the whole ledge and its icicles were painted as two lines tens to
// hundreds of pixels off the window, for as long as the drag went on.
// Falling snow was also painted in front of every window, over its content.
"use strict"
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const { makeHarness, shakePath, jitteryDelay } = require("./attach-harness")
const S = load("lib/sim.js"), D = load("lib/draw.js"), P = load("lib/policy.js")
const dt = 1 / 60

// A 2D context that keeps a log of what is painted, with each point taken
// through the current translation (all draw.js uses on window snow).
function recorder() {
  const log = []
  let tx = 0, ty = 0
  const stack = []
  const pt = (x, y) => ({ x: x + tx, y: y + ty })
  const base = {
    save() { stack.push([tx, ty]); log.push({ op: "save" }) },
    restore() { if (stack.length) [tx, ty] = stack.pop(); log.push({ op: "restore" }) },
    translate(x, y) { tx += x; ty += y },
    setTransform() { tx = 0; ty = 0 },
    resetTransform() { tx = 0; ty = 0 },
    createLinearGradient() { return { addColorStop() {} } },
    createRadialGradient() { return { addColorStop() {} } },
    measureText() { return { width: 10 } },
    getImageData() { return { data: [] } },
  }
  const pointOps = { moveTo: 2, lineTo: 2, quadraticCurveTo: 4, bezierCurveTo: 6, arc: 2, ellipse: 2 }
  const rectOps = { rect: 1, clearRect: 1, fillRect: 1, strokeRect: 1 }
  const ctx = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === "log") return log
      return function(...a) {
        if (k in pointOps) {
          const pts = []
          for (let i = 0; i + 1 < (k === "arc" || k === "ellipse" ? 2 : pointOps[k]); i += 2) pts.push(pt(a[i], a[i + 1]))
          log.push({ op: k, pts })
        } else if (k in rectOps) log.push({ op: k, x: a[0] + tx, y: a[1] + ty, w: a[2], h: a[3] })
        else log.push({ op: k })
      }
    },
    set(t, k, v) { t[k] = v; return true }
  })
  return ctx
}

function worldWith(rects, depth) {
  const w = S.createWorld(1920, 1080, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, { snowScale: 0 })
  const rest = { x: 5, y: 5, vx: 0, vy: 0, present: true, stillFor: 5, age: 0 }
  for (let i = 0; i < 3; i++) { S.setSurfaces(w, rects, w.time, rects.map(r => r.id), { pointer: rest, poll: 0.2, layoutAge: 30 }); S.step(w, dt, { pointer: rest }) }
  w.particles = []
  for (const r of rects) { const s = w.surfaces[r.id]; for (let i = 0; i < s.bins.length; i++) s.bins[i] = depth === undefined ? 6 : depth; s.pack = 0.5 }
  return w
}

// The cap's outline points, as painted, for one surface: those between the
// clip that confines it and its restore.
function capPoints(log) {
  const out = []
  let inCap = false, depth = 0
  for (const e of log) {
    if (e.op === "clip") { inCap = true; depth = 0; continue }
    if (!inCap) continue
    if (e.op === "save") depth++
    if (e.op === "restore") { if (depth === 0) { inCap = false; continue } depth-- }
    if (e.pts) out.push(...e.pts)
  }
  return out
}

test("a window's snow is painted in its own frame: at rest, exactly on its top edge", () => {
  const r = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([r])
  const s = w.surfaces[r.id]
  const pl = D.placeOf(w, s)
  assert.deepStrictEqual([pl.x, pl.y, pl.w, pl.h], [300, 400, 600, 300])
  const ctx = recorder()
  D.world(ctx, w)
  const pts = capPoints(ctx.log)
  assert.ok(pts.length > 10, "a cap was painted")
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), maxY = Math.max(...pts.map(p => p.y))
  assert.ok(minX >= 300 - 12 && maxX <= 900 + 12, `cap spans ${minX}..${maxX}`)
  assert.ok(maxY <= 400 + 3, `cap reaches ${maxY}, below the window's top edge`)
  assert.ok(Math.min(...pts.map(p => p.y)) < 400 - 3, "and it stands above the edge")
})

test("the cap is clipped to the band above its window's top edge", () => {
  const r = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([r])
  const ctx = recorder()
  D.world(ctx, w)
  const i = ctx.log.findIndex(e => e.op === "clip")
  assert.ok(i > 0, "a clip is set before the cap")
  const rect = ctx.log.slice(0, i).reverse().find(e => e.op === "rect")
  assert.ok(rect, "the clip is a rectangle")
  assert.strictEqual(rect.x, 300 - D.CAP_REACH)
  assert.strictEqual(rect.w, 600 + 2 * D.CAP_REACH)
  assert.strictEqual(rect.y + rect.h, 400 + D.CAP_EDGE, "nothing of the cap below the edge's top pixels")
})

test("moved, the window takes its snow along: same profile in its own frame, painted at the new place", () => {
  const r = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([r])
  const s = w.surfaces[r.id]
  for (let i = 0; i < s.bins.length; i++) s.bins[i] = 2 + (i % 7)
  const before = s.bins.slice()
  const ctx0 = recorder(); D.world(ctx0, w)
  const p0 = capPoints(ctx0.log)
  // Moved by the compositor (no drag): a jump, the snow rides along.
  const moved = { ...r, x: -150, y: 120 }      // partly off the screen's left edge
  S.setSurfaces(w, [moved], w.time + 1, [r.id], { pointer: null, poll: 0.2, layoutAge: 0.05 })
  assert.deepStrictEqual(s.bins, before, "the height field, kept per cell of the window, is untouched")
  assert.strictEqual(D.leadOf(w, s), null, "a jump is painted where it landed, not carried on")
  const ctx1 = recorder(); D.world(ctx1, w)
  const p1 = capPoints(ctx1.log)
  assert.strictEqual(p1.length, p0.length)
  for (let i = 0; i < p0.length; i++) {
    assert.ok(Math.abs(p1[i].x - p0[i].x + 450) < 1e-6 && Math.abs(p1[i].y - p0[i].y + 280) < 1e-6, `point ${i} moved by exactly the window's move`)
  }
})

test("dragged slowly, the snow keeps its place along the edge (window-local profile invariant)", () => {
  const r = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([r], 5)
  const s = w.surfaces[r.id]
  const com = () => { let m = 0, mx = 0; for (let i = 0; i < s.bins.length; i++) { m += s.bins[i]; mx += s.bins[i] * i } return { m, c: mx / m } }
  const c0 = com()
  for (let f = 1; f <= 90; f++) {
    const rr = { ...r, x: r.x + f * 2, y: r.y + f }          // 120 px/s right, 60 px/s down
    const ptr = { x: rr.x + 200, y: rr.y + 10, vx: 120, vy: 60, present: true, stillFor: 0, age: 0 }
    S.setSurfaces(w, [rr], w.time, [r.id], { pointer: ptr, poll: dt, layoutAge: 30 })
    S.step(w, dt, { pointer: ptr })
    // Painted where the window will be when the frame shows: carried on
    // along its own motion by about a step (2 px, 1 px a frame), never off it.
    const pl = D.placeOf(w, s)
    const ax = pl.x - rr.x, ay = pl.y - rr.y
    assert.ok(ax >= -1e-9 && ax <= 4 && ay >= -1e-9 && ay <= 2 && Math.abs(ax - 2 * ay) <= 1, `frame ${f}: painted at ${pl.x},${pl.y} for a window at ${rr.x},${rr.y}`)
  }
  const c1 = com()
  assert.ok(Math.abs(c1.c - c0.c) < 0.5, `the snow's centre moved ${(c1.c - c0.c).toFixed(2)} cells along the edge`)
  assert.ok(c1.m > c0.m * 0.97, "and none of it was lost")
})

// The bug itself: a hand shaking a window with short holds at the turns,
// while the window list answers 20 to 140 ms late. The old painter put the
// whole ledge at a stale pointer offset (worst ~220 px; ~10 px off while
// the window was held still mid-drag; ~25 px off during a later steady
// drag). Now the snow's place comes from the window's own latest reading.
test("shaken with the window list answering late, the snow never drifts off its window", () => {
  for (const hold of [0.05, 0.13, 0.2]) {
    const shake = shakePath({ strokes: 7, amp: 200, stroke: 0.14, hold, ax: 1, ay: 0.7 })
    const end = 0.2 + 7 * (0.14 + hold)
    const path = t => t < end + 0.05 ? shake(t) : (() => { const p = shake(end); return { x: p.x + 300 * (t - end - 0.05), y: p.y } })()
    // (Against a build without the snapshot feed this replays that build's
    // own pipeline, so the test tells the two apart by behaviour alone.)
    const h = makeHarness({ path, snapshot: !!S.noteStill, delay: jitteryDelay(7, 0.02, 0.14) })
    h.settle(2, 6)
    const fr = h.run(end + 1.1)
    const off = f => Math.hypot(f.ex, f.ey)
    const moving = fr.filter(f => f.t > 0.2 && f.t < end)
    const held = moving.filter(f => Math.hypot(f.shown.x - h.winAt(f.t - dt).x, f.shown.y - h.winAt(f.t - dt).y) < 0.1 &&
                                    Math.hypot(f.shown.x - h.winAt(f.t - 2 * dt).x, f.shown.y - h.winAt(f.t - 2 * dt).y) < 0.1)
    const steady = fr.filter(f => f.t > end + 0.3 && f.t < end + 1.0)
    assert.ok(Math.max(...moving.map(off)) < 40, `hold ${hold}: worst ${Math.max(...moving.map(off)).toFixed(1)} px off while shaken`)
    assert.ok(held.length > 3 && Math.max(...held.map(off)) < 1, `hold ${hold}: ${Math.max(...held.map(off)).toFixed(1)} px off while held still mid-drag`)
    assert.ok(Math.max(...steady.map(off)) < 2, `hold ${hold}: ${Math.max(...steady.map(off)).toFixed(1)} px off in a steady drag`)
  }
})

test("let go: the moment a fresh reading shows the window still, its snow is painted exactly on it", () => {
  const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)
  const path = t => ({ x: 0, y: -300 * ease((t - 0.2) / 0.3) })
  const h = makeHarness({ path, snapshot: true })
  h.settle(1, 6)
  const fr = h.run(1.2)
  const after = fr.filter(f => f.t > 0.5 + 2 * dt)
  assert.ok(after.every(f => Math.hypot(f.ex, f.ey) < 1e-6), `still ${Math.max(...after.map(f => Math.hypot(f.ex, f.ey))).toFixed(2)} px off after it stopped`)
  const s = h.w.surfaces[h.base.id]
  assert.strictEqual(D.leadOf(h.w, s), null)
})

test("reversed rapidly over and over, there is one cap, always within a step of the window", () => {
  const path = t => ({ x: 0, y: t < 0.2 ? 0 : 60 * Math.sin((t - 0.2) * 2 * Math.PI * 4) })
  const h = makeHarness({ path, snapshot: true, delay: jitteryDelay(3, 0.02, 0.1) })
  h.settle(1, 6)
  let worst = 0
  h.run(2, (f, w, s) => {
    // One window, one surface: one face, one cap (one clip; a second for
    // icicles if any grew).
    const ctx = recorder(); D.world(ctx, w)
    const clips = ctx.log.filter(e => e.op === "clip").length
    assert.ok(clips >= 1 && clips <= 2, `${clips} clips`)
    assert.strictEqual(ctx.log.filter(e => e.op === "clearRect" && e.h >= s.h && e.h <= s.h + 2 * D.DRAW_LEAD_MAX && e.w >= s.w && e.w <= s.w + 2 * D.DRAW_LEAD_MAX).length, 1, "one face")
    worst = Math.max(worst, Math.hypot(f.ex, f.ey))
  })
  // Peak speed 1500 px/s, 25 px a frame.
  assert.ok(worst < 26, `worst ${worst.toFixed(1)} px`)
})

test("a hard shake sheds the ledge as small separate pieces, not as one strip; mass is kept", () => {
  const h = makeHarness({ path: shakePath({ strokes: 8, amp: 260, stroke: 0.08, hold: 0.02, ax: 1, ay: 0 }), snapshot: true })
  h.settle(1, 7)
  const w = h.w, id = h.base.id
  S.setEnv(w, { snowScale: 0 }); w.particles = []
  const mass = () => S.sumOf(w.surfaces[id].bins) + w.surfaces[id].edges[0].m + w.surfaces[id].edges[1].m
  const m0 = mass()
  let biggest = 0, seen = new Set(), dup = 0, airMass = 0
  h.run(1.2, (f, ww) => {
    for (const p of ww.particles) {
      if (p.kind !== "clump" && p.kind !== "powder") continue
      biggest = Math.max(biggest, p.amount || 0)
      if (!seen.has(p)) seen.add(p)
    }
    // No piece is listed twice.
    const set = new Set(ww.particles)
    if (set.size !== ww.particles.length) dup++
  })
  for (const p of w.particles) if ((p.kind === "clump" || p.kind === "powder") && p.rest === null) airMass += p.amount || 0
  assert.ok(seen.size > 20, `the ledge broke into ${seen.size} pieces`)
  assert.strictEqual(dup, 0, "no piece duplicated")
  // A strip of the whole ledge would carry most of its mass; a piece holds a handful of cells.
  assert.ok(biggest < m0 * 0.1, `the biggest piece held ${(100 * biggest / m0).toFixed(1)}% of the ledge`)
  assert.ok(mass() < m0, "snow came off")
})

test("detached pieces have their own motion, in screen coordinates, from where they left the window", () => {
  const h = makeHarness({ path: shakePath({ strokes: 4, amp: 300, stroke: 0.08, hold: 0.03, ax: 1, ay: 0 }), snapshot: true })
  h.settle(1, 7)
  h.w.particles = []; S.setEnv(h.w, { snowScale: 0 })
  let checked = 0
  h.run(0.8, (f, w, s) => {
    for (const p of w.particles) {
      if (p.kind !== "clump" || p.age > dt * 1.01 || p.hold) continue
      // Born this frame: on or just off the window's top, near its span.
      assert.ok(p.y < s.y + 2 && p.y > s.y - 40, `born at y ${p.y.toFixed(1)} for a top at ${s.y}`)
      assert.ok(p.x > s.x - 200 && p.x < s.x + s.w + 200, `born at x ${p.x.toFixed(1)}`)
      assert.ok(isFinite(p.vx) && isFinite(p.vy), "with a motion of its own")
      checked++
    }
  })
  assert.ok(checked > 0, "pieces came off")
})

test("falling snow is painted behind the windows: each window's face is cleared after it", () => {
  const r = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([r])
  w.particles = [
    { kind: "flake", x: 600, y: 550, vx: 0, vy: 40, r: 1.5, depth: 0.9, age: 0, life: 10, rest: null },
    { kind: "clump", x: 620, y: 560, vx: 0, vy: 40, r: 3, amount: 4, pack: 0.5, angle: 0, spin: 0, age: 0, life: 10, rest: null },
  ]
  const ctx = recorder()
  D.world(ctx, w)
  const clear = ctx.log.findIndex(e => e.op === "clearRect" && e.x === 300 && e.y === 400 && e.w === 600 && e.h === 300)
  assert.ok(clear > 0, "the window's face is cleared")
  const after = ctx.log.slice(clear + 1)
  const inside = e => e.pts && e.pts.some(p => p.x > 310 && p.x < 890 && p.y > 410 && p.y < 690)
  assert.ok(ctx.log.slice(0, clear).some(inside), "the falling snow over the window was painted before it")
  assert.ok(!after.some(inside), "and nothing is painted inside the window after its face is cleared")
})

test("overlapping windows: the snow on the one behind is hidden where the front one covers it", () => {
  const back = { id: "0xb", x: 200, y: 300, w: 800, h: 400, floating: true, z: 5 }
  const front = { id: "0xf", x: 500, y: 250, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([back, front])
  const ctx = recorder()
  D.world(ctx, w)
  const log = ctx.log
  const clipAt = log.map((e, i) => e.op === "clip" ? i : -1).filter(i => i >= 0)
  assert.strictEqual(clipAt.length, 2, "two caps")
  // Painted back to front: the back cap, then the front window's face cleared over it.
  const backCap = capPoints(log.slice(clipAt[0] - 3, clipAt[1] - 3))
  assert.ok(backCap.length && backCap.every(p => p.y <= 303), "the back cap is on the back window")
  const frontClear = log.findIndex((e, i) => i > clipAt[0] && e.op === "clearRect" && e.x === 500 && e.y === 250)
  assert.ok(frontClear > clipAt[0], "the front window's face is cleared after the back cap is painted")
  assert.ok(S.surfaceCovered(w, back.id, 700, 296), "the covered part of the back ledge counts as hidden")
  assert.ok(!S.surfaceCovered(w, back.id, 300, 296), "the rest does not")
})

test("a closed window takes everything attached to it along; nothing stays painted where it was", () => {
  const a = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const h = makeHarness({ path: shakePath({ strokes: 3, amp: 200, stroke: 0.1, hold: 0.05 }), snapshot: true, icicles: true, window: a })
  h.settle(1, 6)
  const w = h.w
  w.particles.push({ kind: "flake", x: 500, y: 398, vx: 0, vy: 0, r: 1, depth: 1, age: 0, life: 99, rest: a.id, ox: 200 })
  h.run(0.4)                                    // mid-drag
  S.setSurfaces(w, [], w.time, [], { pointer: null, poll: dt, layoutAge: 0 })
  assert.ok(!w.surfaces[a.id], "its surface is gone")
  assert.ok(!w.stash[a.id], "nothing kept aside for it")
  for (const p of w.particles) {
    assert.notStrictEqual(p.rest, a.id, "nothing rests on it")
    assert.notStrictEqual(p.hold, a.id, "nothing is held up by it")
  }
  S.step(w, dt, {})
  const ctx = recorder(); D.world(ctx, w)
  assert.strictEqual(ctx.log.filter(e => e.op === "clip").length, 0, "no cap is painted")
  assert.ok(!ctx.log.some(e => e.op === "clearRect" && e.w === a.w && e.h === a.h), "and no face")
})

test("resized, the snow is re-cut to the new width and painted where the window is", () => {
  const r = { id: "0xa", x: 300, y: 400, w: 600, h: 300, floating: true, z: 0 }
  const w = worldWith([r])
  const s = w.surfaces[r.id]
  S.setSurfaces(w, [{ ...r, x: 0, y: 0, w: 1920, h: 1050 }], w.time + 0.02, [r.id], { pointer: null, poll: dt, layoutAge: 0.01 })   // maximized
  assert.strictEqual(s.bins.length, Math.ceil(1920 / S.CELL))
  assert.strictEqual(D.leadOf(w, s), null)
  const pl = D.placeOf(w, s)
  assert.deepStrictEqual([pl.x, pl.y, pl.w], [0, 0, 1920])
  S.setSurfaces(w, [r], w.time + 0.5, [r.id], { pointer: null, poll: dt, layoutAge: 0.01 })                                           // restored
  assert.strictEqual(s.bins.length, Math.ceil(600 / S.CELL))
  assert.deepStrictEqual(Object.values(D.placeOf(w, s)), [300, 400, 600, 300])
})

// ----------------------------------------------------- the pointer feed

test("the pointer batch reply is read whole, however it arrives", () => {
  const reply = "{\n  \"x\": 1234,\n  \"y\": -56\n}\n\n\n{\n  \"address\": \"0x55d0c0ffee\",\n  \"mapped\": true,\n  \"at\": [-1700, 80],\n  \"size\": [900, 500],\n  \"title\": \"vim }\\n\\n{ x\"\n}"
  const r = P.parseCursorReply(reply)
  assert.strictEqual(r.state, "ok")
  assert.deepStrictEqual([r.x, r.y], [1234, -56])
  assert.deepStrictEqual(r.win, { address: "0x55d0c0ffee", x: -1700, y: 80, w: 900, h: 500 })
  for (let cut = 1; cut < reply.length - 1; cut += 7) assert.strictEqual(P.parseCursorReply(reply.slice(0, cut)).state, "partial", `cut at ${cut}`)
  assert.strictEqual(P.parseCursorReply("{\"x\":1,\"y\":2}\n\n\n{}").win, null, "no window focused")
  assert.deepStrictEqual(P.parseCursorReply("640, 360"), { state: "ok", x: 640, y: 360, win: null }, "a plain cursorpos still reads")
  assert.strictEqual(P.parseCursorReply("unknown request").state, "bad")
})

test("the focused window's rectangle comes from the snapshot while it is fresh, screen-local (any monitor)", () => {
  const rects = [{ id: "0xa", x: 10, y: 20, w: 300, h: 200 }, { id: "0xb", x: 400, y: 20, w: 300, h: 200 }]
  // A monitor left of the primary one: its origin is negative.
  const snap = { id: "0xa", x: -1920 + 60, y: 90, w: 320, h: 210, at: 10000 }
  const out = P.withSnapshot(rects, snap, 10008, -1920, 0, 9970, 150)
  assert.deepStrictEqual([out[0].x, out[0].y, out[0].w, out[0].h], [60, 90, 320, 210])
  assert.ok(Math.abs(out[0].age - 0.008) < 1e-9)
  assert.deepStrictEqual([out[1].x, out[1].y], [400, 20], "other windows come from the list")
  assert.ok(Math.abs(out[1].age - 0.038) < 1e-9)
  const stale = P.withSnapshot(rects, snap, 10200, -1920, 0, 10190, 150)
  assert.deepStrictEqual([stale[0].x, stale[0].y], [10, 20], "a stale snapshot is not used")
  assert.notStrictEqual(out[0], rects[0], "the list itself is left as it was")
})

test("the pointer feed batches the pointer and the focused window", () => {
  const fs = require("fs"), path = require("path")
  const svc = fs.readFileSync(path.join(__dirname, "..", "Service.qml"), "utf8")
  const scene = fs.readFileSync(path.join(__dirname, "..", "SceneWindow.qml"), "utf8")
  assert.strictEqual(P.CURSOR_BATCH, "[[BATCH]]j/cursorpos;j/activewindow")
  assert.match(svc, /write\(root\.cursorBatch \? Policy\.CURSOR_BATCH : "cursorpos"\)/)
  assert.match(svc, /Policy\.parseCursorReply\(text\)/)
  assert.match(scene, /Policy\.withSnapshot\(rects, service\.focusSnap/)
  assert.match(scene, /Sim\.noteStill\(world, \[snap\.id\]\)/)
  // The window poll still runs for every other window.
  assert.match(svc, /Hyprland\.refreshToplevels\(\)/)
})
