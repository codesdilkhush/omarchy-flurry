// Renders snowballs at play: a handful scooped from the ground snow, a ball
// rolled along it (growing, with its track behind), one lifted in the hand,
// one in flight after a throw, a splat on a window, and two stacked; plus a
// close-up of a rolled ball sitting in its track.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-snowballs.js out.png [closeup.png]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "snowballs.png"
const closeOut = process.argv[3]

const W = 1280, H = 560, dt = 1 / 60
const win = { id: "term", x: 760, y: 150, w: 420, h: 260, floating: true, z: 0 }

function snowyWorld() {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1.4, plow: false })
  S.setSurfaces(w, [win], 0)
  for (let t = 0; t < 70; t += dt) S.step(w, dt)
  // A night's worth on the ground, settled, in soft drifts.
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => 15 + 4 * Math.sin(i * 0.045) + 2.5 * Math.sin(i * 0.13 + 1) + 1.2 * Math.sin(i * 0.41))
  for (const s of Object.values(w.surfaces)) s.pack = 0.75
  return w
}
const base = snowyWorld()
const fork = () => {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1.4, plow: false })
  S.setSurfaces(w, [win], 0)
  for (const id of Object.keys(base.surfaces)) {
    const s = w.surfaces[id], o = base.surfaces[id]
    s.bins = o.bins.slice(); s.pack = o.pack
  }
  w.particles = base.particles.filter(p => p.kind === "flake").map(p => Object.assign({}, p))
  return w
}
const run = (w, secs, each) => { for (let t = 0; t < secs - 1e-9; t += dt) { S.setSurfaces(w, [win], w.time); if (each) each(t); S.step(w, dt) } }
const groundTop = (w, x) => H - S.heightAt(w.surfaces.__ground, x)

function paint(w, label, scale, crop) {
  scale = scale || 1
  crop = crop || [0, 0, W, H]
  const c = createCanvas(crop[2] * scale, crop[3] * scale), ctx = c.getContext("2d")
  ctx.scale(scale, scale); ctx.translate(-crop[0], -crop[1])
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#182033"); g.addColorStop(1, "#33405e")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = "#0e1118"; ctx.fillRect(win.x, win.y, win.w, win.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(win.x, win.y, win.w, win.h)
  ctx.fillStyle = "#9ece6a"; ctx.font = "14px monospace"
  ctx.fillText("~ $ flurry status", win.x + 16, win.y + 30)
  const layer = createCanvas(W, H)
  D.world(layer.getContext("2d"), w)
  ctx.drawImage(layer, 0, 0)
  if (label) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = (15 * scale) + "px sans-serif"
    ctx.fillText(label, 14 * scale, 26 * scale)
  }
  return c
}

const frames = []
// 1. A handful scooped from the ground.
{
  const w = fork()
  S.grabSnow(w, 200, groundTop(w, 200) + 2)
  run(w, 0.15, () => S.dragSnow(w, 206, groundTop(w, 206)))
  frames.push(paint(w, "Press on the snow: a handful comes up"))
}
// 2. Rolled along the ground: it grows and leaves a pressed track.
let rolled
{
  const w = fork()
  S.grabSnow(w, 80, groundTop(w, 80) + 2)
  let x = 80
  run(w, 2.6, () => { x += 230 * dt; S.dragSnow(w, x, groundTop(w, x) + 2) })
  frames.push(paint(w, "Drag it along: it rolls, grows and packs a track"))
  rolled = w
}
// 3. Lifted in the hand.
{
  const w = fork()
  S.grabSnow(w, 80, groundTop(w, 80) + 2)
  let x = 80, y
  run(w, 2.2, () => { x += 230 * dt; S.dragSnow(w, x, groundTop(w, x) + 2) })
  y = w.hand.y
  run(w, 0.5, () => { y -= 520 * dt; x += 60 * dt; S.dragSnow(w, x, y) })
  frames.push(paint(w, "Hold it to lift it"))
}
// 4. Thrown.
let thrown
{
  const w = fork()
  S.grabSnow(w, 80, groundTop(w, 80) + 2)
  let x = 80, y
  run(w, 1.4, () => { x += 200 * dt; S.dragSnow(w, x, groundTop(w, x) + 2) })
  y = w.hand.y
  run(w, 0.4, () => { y -= 500 * dt; S.dragSnow(w, x, y) })
  run(w, 0.1, () => { x += 1000 * dt; y -= 500 * dt; S.dragSnow(w, x, y) })
  S.letGo(w)
  const trail = []
  run(w, 0.32, () => { const b = w.balls[0]; if (b) trail.push([b.x, b.y, b.r]) })
  const c = paint(w, "Let go to throw it")
  const ctx = c.getContext("2d")
  trail.forEach(([tx, ty, tr], i) => {
    if (i % 3) return
    ctx.globalAlpha = 0.12 + 0.25 * i / trail.length
    ctx.fillStyle = "#e9f0fb"
    ctx.beginPath(); ctx.arc(tx, ty, tr * 0.92, 0, Math.PI * 2); ctx.fill()
  })
  ctx.globalAlpha = 1
  frames.push(paint(w, "Let go to throw it"))
  frames[frames.length - 1] = c
  thrown = w
}
// 5. A splat on the window.
{
  const w = thrown
  let hit = false
  run(w, 1.2, () => { if (!w.balls.length && !hit) hit = true })
  const w2 = fork()
  const b = S.makeBall(w2, 980, 40, Math.PI * 16 * 16, 0.85)
  b.vy = 1700; b.vx = 120
  w2.balls.push(b)
  run(w2, 0.12)
  frames.push(paint(w2, "Thrown hard, it bursts"))
}
// 6. Two stacked.
{
  const w = fork()
  const big = S.makeBall(w, 380, groundTop(w, 380) - 36, Math.PI * 38 * 38, 0.85)
  big.round = 1
  w.balls.push(big)
  run(w, 1)
  const small = S.makeBall(w, big.x + 2, big.y - big.r - 26, Math.PI * 24 * 24, 0.85)
  small.round = 1
  w.balls.push(small)
  const tiny = S.makeBall(w, 640, groundTop(w, 640) - 10, Math.PI * 9 * 9, 0.8)
  w.balls.push(tiny)
  run(w, 1.5)
  frames.push(paint(w, "They knock into each other and stack"))
}

const cols = 2, fw = W / 2, fh = H / 2
const sheet = createCanvas(cols * fw, Math.ceil(frames.length / cols) * fh)
const sctx = sheet.getContext("2d")
frames.forEach((f, i) => sctx.drawImage(f, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh))
fs.writeFileSync(out, sheet.toBuffer("image/png"))

if (closeOut) {
  const b = rolled.balls[0]
  S.letGo(rolled)
  run(rolled, 1.5)
  const cx = Math.max(0, Math.min(W - 420, b.x - 260)), cy = H - 190
  fs.writeFileSync(closeOut, paint(rolled, "", 2.5, [cx, cy, 420, 190]).toBuffer("image/png"))
}
console.log(JSON.stringify(S.stats(rolled).balls))
