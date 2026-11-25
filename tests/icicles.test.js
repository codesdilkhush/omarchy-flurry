// Icicles hang from the window, not under it: Hyprland's window geometry
// leaves out the border it draws, so from a bottom edge they hang from the
// border's outer edge (the shell reads general:border_size and passes it as
// { border }). They run the whole width of the window, and the new painter
// (ridge, wavy taper, outline, highlight, rings, glint) is Qt-clean.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const load = require("./load")
const Q = require("./qtcanvas")
const S = load("lib/sim.js")
const D = load("lib/draw.js")

const dt = 1 / 30
const FLOAT = { id: "0xf1", x: 300, y: 200, w: 900, h: 300, floating: true, z: 0 }

function frozen(border) {
  const w = S.createWorld(1600, 900, { effect: "snow", intensity: 1.2, groundInset: 0 })
  if (border !== undefined) S.setFeatures(w, { border })
  for (let t = 0; t < 40; t += dt) { S.setSurfaces(w, [FLOAT], w.time); S.step(w, dt, {}) }
  S.freezeNow(w)
  return w
}

test("setFeatures takes the compositor's border width, clamped and rounded", () => {
  const w = S.createWorld(800, 600, { effect: "snow" })
  S.setFeatures(w, { border: 2 }); assert.strictEqual(w.border, 2)
  S.setFeatures(w, { border: 3.6 }); assert.strictEqual(w.border, 4)
  S.setFeatures(w, { border: -5 }); assert.strictEqual(w.border, 0)
  S.setFeatures(w, { border: 99 }); assert.strictEqual(w.border, 20)
  S.setFeatures(w, { border: "x" }); assert.strictEqual(w.border, 0)
  S.setFeatures(w, { gusts: true }); assert.strictEqual(w.border, 0, "other switches leave it alone")
})

test("from a bottom edge they hang from the border's outer edge", () => {
  for (const b of [0, 2, 5]) {
    const w = frozen(b)
    const s = w.surfaces[FLOAT.id]
    assert.strictEqual(s.iceAt, "bottom")
    assert.strictEqual(S.iceRoot(w, s), FLOAT.y + FLOAT.h + b)
  }
  // Under the snow at the top the border makes no difference.
  const w = frozen(4), s = w.surfaces[FLOAT.id]
  s.iceAt = "top"
  assert.strictEqual(S.iceRoot(w, s), FLOAT.y)
})

test("they run the whole width of the window, a few with a small one beside them", () => {
  const s = frozen(2).surfaces[FLOAT.id]
  const xs = s.icicles.map(i => i.ox)
  assert.ok(xs.length >= 20, xs.length + " icicles on a 900 px window")
  assert.ok(Math.min(...xs) < 40 && Math.max(...xs) > FLOAT.w - 70, `from ${Math.min(...xs)} to ${Math.max(...xs)}`)
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], "sorted left to right")
  assert.ok(s.icicles.some(i => i.max >= 25), "some grow long")
})

test("the painter is Qt-clean and keeps to the window's edge", () => {
  const w = frozen(2), s = w.surfaces[FLOAT.id]
  let calls = []
  const e = Q.paint(ctx => {
    const proxy = new Proxy(ctx, { get(t, k) {
      const v = t[k]
      if (typeof v !== "function") return v
      return function(...a) { if (k === "moveTo" || k === "lineTo") calls.push(a); return v.apply(t, a) }
    } })
    D.drawIcicles(proxy, s, 2)
  })
  assert.strictEqual(e, null, e && e.message)
  const ys = calls.map(a => a[1])
  // Nothing above the window's bottom edge (the content stays clear), and
  // the ice starts right at it, over the border: no gap.
  assert.ok(Math.min(...ys) >= FLOAT.y + FLOAT.h - 0.01, "min y " + Math.min(...ys))
  assert.ok(Math.min(...ys) <= FLOAT.y + FLOAT.h + 0.01, "ridge starts at the edge")
  const xs = calls.map(a => a[0])
  assert.ok(Math.min(...xs) >= FLOAT.x - 0.01 && Math.max(...xs) <= FLOAT.x + FLOAT.w + 0.01, "within the window's width")
  // Empty and tiny lists draw nothing and do not throw.
  assert.strictEqual(Q.paint(c => D.drawIcicles(c, { x: 0, y: 0, w: 100, h: 50, icicles: [] }, 2)), null)
  assert.strictEqual(Q.paint(c => D.drawIcicles(c, { x: 0, y: 0, w: 100, h: 50, icicles: [{ ox: 50, len: 0.2, w: 3, kink: 0 }] }, 2)), null)
})

test("the shell reads general:border_size once, again on configreloaded, and passes it on", () => {
  const svc = fs.readFileSync(path.join(__dirname, "..", "Service.qml"), "utf8")
  const scene = fs.readFileSync(path.join(__dirname, "..", "SceneWindow.qml"), "utf8")
  assert.match(svc, /"getoption", "general:border_size"/)
  assert.match(svc, /name === "configreloaded"\) root\.readBorder\(\)/)
  assert.match(svc, /onShowingChanged: if \(showing && !borderRead\) readBorder\(\)/)
  assert.doesNotMatch(svc, /Timer \{[^}]*readBorder/, "never on a timer")
  assert.match(scene, /border: service\.windowBorder/)
  assert.match(scene, /function onWindowBorderChanged\(\) \{ sceneWin\.applyFeatures\(\) \}/)
})
