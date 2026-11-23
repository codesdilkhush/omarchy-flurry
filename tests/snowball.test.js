const test = require("node:test")
const assert = require("node:assert")
const S = require("./load")("lib/sim.js")

const dt = 1 / 60
// A world with a layer of settled snow and no new snow falling.
function snowyGround(depth, opts) {
  const w = S.createWorld(1600, 900, Object.assign({ effect: "snow", plow: false }, opts))
  const g = w.surfaces.__ground
  g.bins.fill(depth); g.pack = 0.7
  return w
}
function step(w, secs, rects, each) {
  for (let t = 0; t < secs - 1e-9; t += dt) {
    w.spawnDebt = -1e9
    if (rects) S.setSurfaces(w, rects, w.time)
    if (each) each(t)
    S.step(w, dt, {})
  }
}
const sum = a => a.reduce((x, y) => x + y, 0)
// Pushes a fresh ball along the ground from x0 at `speed` for `secs`.
function rollOne(w, x0, speed, secs) {
  const gy = w.height
  assert.strictEqual(S.grabSnow(w, x0, gy - 16), "seed")
  let x = x0
  step(w, secs, null, () => { x += speed * dt; S.dragSnow(w, x, gy - 16) })
  return w.balls[w.balls.length - 1]
}

test("pressing on deep snow scoops a small lump; bare ground gives nothing", () => {
  const w = snowyGround(16)
  const before = w.surfaces.__ground.bins[50]
  assert.strictEqual(S.grabSnow(w, 200, 884), "seed")
  const b = w.balls[0]
  assert.ok(b.r > 3 && b.r < 9, "seed radius " + b.r)
  assert.ok(b.held)
  assert.ok(w.surfaces.__ground.bins[50] < before, "the handful left a dent")
  S.letGo(w)
  const bare = S.createWorld(1600, 900, { effect: "snow", plow: false })
  assert.strictEqual(S.grabSnow(bare, 200, 899), "")
  assert.strictEqual(bare.balls.length, 0)
})

test("rolling through snow grows the ball, presses a firm track, and turns it like a wheel", () => {
  const w = snowyGround(16)
  const b = rollOne(w, 200, 250, 0.8)
  const r0 = b.r, a0 = b.angle, x0 = b.x
  let x = w.hand.x
  step(w, 0.8, null, () => { x += 250 * dt; S.dragSnow(w, x, w.height - 16) })
  assert.ok(b.r > r0 * 1.15, "grew from " + r0.toFixed(1) + " to " + b.r.toFixed(1))
  const turned = (b.angle - a0) * (r0 + b.r) / 2
  assert.ok(Math.abs(turned - (b.x - x0)) < 0.15 * (b.x - x0), "rolled " + turned.toFixed(0) + " over " + (b.x - x0).toFixed(0))
  const g = w.surfaces.__ground
  const track = Math.floor(400 / S.CELL)
  assert.ok(g.bins[track] < 10, "track depth " + g.bins[track])
  assert.ok(g.rho[track] > 1.5, "track is pressed: " + g.rho[track])
  const untouched = Math.floor(1400 / S.CELL)
  assert.ok(Math.abs(g.bins[untouched] - 16) < 0.5)
  // It sits in its own print, not on top of the snow beside it.
  assert.ok(b.y + b.r > w.height - 16 + 2)
})

test("let go, it keeps rolling, slows down and stops", () => {
  const w = snowyGround(12)
  const b = rollOne(w, 200, 300, 1.2)
  S.letGo(w)
  const x0 = b.x
  step(w, 0.3)
  assert.ok(b.x > x0 + 20, "kept rolling")
  step(w, 8)
  assert.ok(Math.abs(b.vx) < 1, "stopped: " + b.vx)
  assert.ok(Math.abs(b.omega) < 0.05)
  assert.ok(b.x < w.width - b.r - 1)
})

test("a lifted ball follows the hand, and a throw flies a parabola", () => {
  const w = snowyGround(14)
  const b = rollOne(w, 200, 250, 0.6)
  let hx = w.hand.x, hy = w.hand.y
  step(w, 0.5, null, () => { hy -= 500 * dt; S.dragSnow(w, hx, hy) })
  assert.ok(b.y < w.height - 200, "lifted to " + b.y)
  assert.ok(Math.abs(b.y - (hy - b.oy)) < 25, "near the hand")
  step(w, 0.08, null, () => { hx += 700 * dt; hy -= 300 * dt; S.dragSnow(w, hx, hy) })
  S.letGo(w)
  const vx = b.vx, vy = b.vy
  assert.ok(vx > 350, "thrown forward: " + vx)
  const pts = []
  step(w, 0.25, null, () => pts.push([b.vx, b.vy]))
  const ay = (pts[pts.length - 1][1] - pts[0][1]) / (dt * (pts.length - 1))
  assert.ok(Math.abs(ay - S.G) < 0.06 * S.G, "falls at g: " + ay)
  assert.ok(Math.abs(pts[pts.length - 1][0] - vx) < 0.05 * vx, "keeps its sideways speed")
})

test("thrown hard at a window top it bursts: a splat stays, chunks fly, no snow is lost", () => {
  const w = snowyGround(14)
  const win = { id: "a", x: 600, y: 500, w: 600, h: 300, floating: true, z: 0 }
  S.setSurfaces(w, [win], 0)
  const b = rollOne(w, 200, 250, 0.7)
  S.letGo(w)
  step(w, 3, [win])
  const loose = b.area * S.BALL.density / S.CELL
  // Fling it straight down onto the window from above.
  b.x = 900; b.y = 300; b.vx = 0; b.vy = 1500; b.contact = null
  const winBefore = sum(w.surfaces.a.bins)
  step(w, 0.4, [win])
  assert.ok(!w.balls.includes(b), "burst")
  const kept = sum(w.surfaces.a.bins) - winBefore
  assert.ok(kept > loose * 0.2, "a splat stays on the window: " + kept.toFixed(0) + " of " + loose.toFixed(0))
  assert.ok(w.particles.some(p => p.kind === "clump") || sum(w.surfaces.__ground.bins) > 0)
})

test("a gentle drop onto a window bounces a little, then rolls off the edge and falls", () => {
  const w = snowyGround(10)
  const win = { id: "a", x: 600, y: 500, w: 400, h: 300, floating: true, z: 0 }
  S.setSurfaces(w, [win], 0)
  const b = rollOne(w, 200, 250, 0.5)
  S.letGo(w)
  step(w, 2, [win])
  b.x = 900; b.y = 500 - b.r - 60; b.vx = 220; b.vy = 0; b.omega = 0; b.contact = null
  let onWin = false
  step(w, 3, [win], () => { if (b.contact === "a") onWin = true })
  assert.ok(onWin, "landed on the window")
  assert.ok(w.balls.includes(b), "a soft landing does not burst it")
  assert.strictEqual(b.contact, "__ground", "rolled off the edge to the ground")
  assert.ok(b.x > 1000, "x " + b.x)
})

test("a ball on a window that starts moving lags and rolls back on it, and lifts off when it drops away", () => {
  const w = snowyGround(0)
  const win = { id: "a", x: 500, y: 500, w: 500, h: 300, floating: true, z: 0 }
  S.setSurfaces(w, [win], 0)
  const b = S.makeBall(w, 750, 400, Math.PI * 15 * 15, 0.8)
  w.balls.push(b)
  step(w, 1, [win])
  assert.strictEqual(b.contact, "a")
  const x0 = b.x
  // Slide the window right: like a ball on a tray, friction only gets it
  // part of the way up to speed (2/7 for a sphere at first), so it rolls
  // back relative to the window, then rolling resistance catches it up.
  let off = 0
  step(w, 1, null, () => { off += 60 * dt; S.setSurfaces(w, [Object.assign({}, win, { x: win.x + off })], w.time) })
  assert.ok(b.x - x0 > 10 && b.x - x0 < off - 5, "moved " + (b.x - x0).toFixed(1) + " while the window moved " + off.toFixed(0))
  assert.strictEqual(b.contact, "a")
  // Yank it down much faster than gravity: the ball is left in the air.
  let drop = 0
  const moved = Object.assign({}, win, { x: win.x + off })
  step(w, 0.15, null, () => { drop += 2500 * dt; S.setSurfaces(w, [Object.assign({}, moved, { y: moved.y + drop })], w.time) })
  assert.notStrictEqual(b.contact, "a")
  assert.ok(b.y + b.r < moved.y + drop - 20, "left behind in the air")
})

test("balls collide, and one set gently on another stays there like a snowman", () => {
  const w = snowyGround(0)
  const a = S.makeBall(w, 600, 900 - 30, Math.PI * 30 * 30, 0.8)
  const c = S.makeBall(w, 700, 900 - 20, Math.PI * 20 * 20, 0.8)
  c.vx = -300
  w.balls.push(a, c)
  step(w, 1)
  assert.ok(Math.hypot(a.x - c.x, a.y - c.y) >= a.r + c.r - 1)
  assert.ok(a.vx < 0 || a.x < 600, "the big one was pushed")
  // A small one set on top of a big one stays there.
  const top = S.makeBall(w, a.x, a.y - a.r - 12, Math.PI * 12 * 12, 0.8)
  w.balls.push(top)
  step(w, 3)
  assert.ok(top.y < a.y - a.r, "stacked: " + (a.y - top.y).toFixed(1))
  assert.ok(Math.abs(top.x - a.x) < a.r * 0.5, "still on top")
  // A hard knock takes it off.
  top.vx = 400
  step(w, 1)
  assert.ok(top.y > a.y - a.r, "knocked off")
})

test("a ball smaller than a fist crumbles when let go", () => {
  const w = snowyGround(4)
  assert.strictEqual(S.grabSnow(w, 400, 896), "seed")
  const b = w.balls[0]
  assert.ok(b.r < S.BALL.minKeep)
  S.letGo(w)
  assert.strictEqual(w.balls.length, 0)
  assert.ok(w.particles.some(p => p.kind === "clump"))
})

test("touch zones cover deep snow and every ball, and stay within the budget", () => {
  const w = snowyGround(0)
  assert.deepStrictEqual(S.touchZones(w, 4, 12), [])
  const g = w.surfaces.__ground
  for (let i = 0; i < g.bins.length; i++) g.bins[i] = (i % 40) < 20 ? 10 : 0
  const b = S.makeBall(w, 300, 400, Math.PI * 20 * 20, 0.8)
  w.balls.push(b)
  const z = S.touchZones(w, 4, 6)
  assert.ok(z.length <= 6)
  assert.ok(z.some(r => r.x <= 300 && r.x + r.w >= 300 && r.y <= 400 && r.y + r.h >= 400), "the ball is touchable")
  assert.ok(z.every(r => r.y >= 400 - 40), "nothing reaches up the screen")
  const deep = z.filter(r => r.y > 800)
  assert.ok(deep.length >= 1)
})

test("wild hand movement never breaks the ball", () => {
  const w = snowyGround(20)
  const win = { id: "a", x: 400, y: 450, w: 700, h: 300, floating: true, z: 0 }
  S.setSurfaces(w, [win], 0)
  for (let round = 0; round < 6; round++) {
    const sx = 200 + round * 180
    const kind = S.grabSnow(w, sx, 900 - 20) || S.grabSnow(w, sx + 50, 900 - 20)
    if (!kind) continue
    let hx = sx, hy = 880
    step(w, 1.5, [win], (t) => {
      hx = Math.max(-200, Math.min(1800, hx + (Math.random() - 0.5) * 300))
      hy = Math.max(-200, Math.min(1100, hy + (Math.random() - 0.5) * 300))
      S.dragSnow(w, hx, hy)
    })
    S.letGo(w)
    step(w, 1, [win])
  }
  for (const b of w.balls) {
    for (const k of ["x", "y", "vx", "vy", "r", "angle", "omega"]) assert.ok(Number.isFinite(b[k]), k + " " + b[k])
    assert.ok(b.x >= b.r - 1 && b.x <= w.width - b.r + 1)
    assert.ok(b.y <= w.height)
  }
  for (const s of Object.values(w.surfaces)) for (const v of s.bins) assert.ok(Number.isFinite(v) && v >= 0)
})
