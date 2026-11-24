// Renders the visitors and the ice as they look live: the hare mid-hop
// with its tracks, the hare sat up with its ears raised, the robin on a
// ledge, and a frozen tiled desktop at night (icicles under the snow, frost
// in the corners), plus a strip of the hare's hop.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-critters.js out.png
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js"), D = load("lib/draw.js"), Season = load("lib/season.js")
const out = process.argv[2] || "critters.png"
const W = 1920, H = 1080, dt = 1 / 60
const NIGHT = Season.environment(new Date(2026, 10, 24, 21, 30), { weather: null, seasons: true, dayCycle: true })
const BG = "#1e1e2e", WIN = "#181825", EDGE = "#89b4fa", TEXT = "#a6adc8"
const TILED = [
  { id: "0xa1", x: 10, y: 38, w: 945, h: 1032, z: 0, floating: false, label: "~ $ nvim notes.md" },
  { id: "0xa2", x: 965, y: 38, w: 945, h: 520, z: 1, floating: false, label: "~ $ htop" },
  { id: "0xa3", x: 965, y: 568, w: 945, h: 502, z: 2, floating: false, label: "~ $ btop" }
]
const run = (w, rects, secs, input) => { for (let t = 0; t < secs - 1e-9; t += dt) { S.setSurfaces(w, rects, w.time); S.step(w, dt, input) } }

function panel(w, rects, label, zoom, pw, ph) {
  const c = createCanvas(pw, ph), ctx = c.getContext("2d")
  const k = zoom.k
  ctx.save(); ctx.scale(k, k); ctx.translate(-(zoom.x - pw / k / 2), -(zoom.y - ph / k / 2))
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = "#11111b"; ctx.fillRect(0, 0, W, 28)
  for (const r of rects.slice().sort((a, b) => b.z - a.z)) {
    ctx.fillStyle = WIN; ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = EDGE; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
    ctx.fillStyle = TEXT; ctx.font = "14px monospace"; ctx.fillText(r.label || "", r.x + 16, r.y + 40)
    for (let i = 0; i < 12; i++) { ctx.fillStyle = "rgba(166,173,200,0.25)"; ctx.fillRect(r.x + 16, r.y + 60 + i * 22, 120 + ((i * 97) % 380), 9) }
  }
  ctx.restore()
  // The scene on its own layer (it clears what is under it), over the desktop.
  const layer = createCanvas(pw, ph), lc = layer.getContext("2d")
  lc.scale(k, k); lc.translate(-(zoom.x - pw / k / 2), -(zoom.y - ph / k / 2))
  D.world(lc, w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, ph - 30, pw, 30)
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = "15px sans-serif"; ctx.fillText(label, 12, ph - 10)
  return c
}

const PW = 760, PH = 420
const panels = []
// Ground snow, settled, the sky nearly clear so the animals read.
function groundWorld(depth) {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, Object.assign({}, NIGHT, { snowScale: 0.1 }))
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => depth + 2 * Math.sin(i * 0.05) + Math.sin(i * 0.17 + 1))
  g.pack = 0.85
  return w
}

// 1. The hare mid-hop, its tracks behind it.
{
  const w = groundWorld(14)
  const rects = [Object.assign({}, TILED[0], { h: 980 })]
  S.spawnRabbit(w, { dir: 1 }); w.rabbit.x = 640; w.rabbit.x0 = 640; w.rabbit.stay = 1e9; w.rabbit.hopsLeft = 1e9
  run(w, rects, 3.0)
  const R = w.rabbit
  while (!(R.lift > R.hopLen * 0.3 && R.pose > 0.6)) run(w, rects, dt)
  w.particles = w.particles.filter(p => p.kind !== "flake")
  panels.push(panel(w, rects, "A winter hare hops along the snow: hind prints side by side ahead of the forefeet", { x: R.x - 70, y: H - 40, k: 4.2 }, PW, PH))
}
// 2. Sat up, ears raised, nose twitching.
{
  const w = groundWorld(14)
  S.spawnRabbit(w, { dir: -1 }); w.rabbit.x = 900; w.rabbit.x0 = 900
  w.rabbit.stay = 1e9; w.rabbit.mode = "rest"; w.rabbit.sitUp = true; w.rabbit.restFor = 99; w.rabbit.t = 0
  w.rabbit.x = 900
  run(w, [], 2.2)
  w.particles = w.particles.filter(p => p.kind !== "flake")
  panels.push(panel(w, [], "It stops, sits up with its ears raised, nose twitching", { x: 900, y: H - 30, k: 6 }, PW, PH))
}
// 3. The robin on a snowy ledge at the top of a tiled desktop.
{
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1.2, plow: false })
  S.setEnv(w, NIGHT)
  run(w, TILED, 60)
  S.spawnBird(w, { surface: "0xa2" })
  w.bird.ox = 420; w.bird.facing = -1
  run(w, TILED, 3)
  if (w.bird) { w.bird.act = "peck"; w.bird.actT = 0.16; w.bird.peck = 0.6; w.bird.stay = 99; w.bird.look = 0.2 }
  run(w, TILED, dt)
  w.particles = w.particles.filter(p => p.kind !== "flake" || Math.random() < 0.3)
  const B = w.bird
  panels.push(panel(w, TILED, "A robin on a deep ledge right under the bar (where it used to find no room)", { x: B.x, y: Math.max(B.y - 10, PH / 5 / 2 + 2), k: 5 }, PW, PH))
}
// 4. A frozen tiled desktop at night: icicles hang under the snow, frost in the corners.
{
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  S.setEnv(w, NIGHT)
  run(w, TILED, 150)
  w.particles = w.particles.filter(p => p.kind !== "flake" || Math.random() < 0.5)
  panels.push(panel(w, TILED, "A November night, live weather off: windows freeze in two minutes", { x: 1060, y: 100, k: 2.4 }, PW, PH))
}

// 5. The hop, frame by frame.
const strip = createCanvas(PW * 2, 170), sc = strip.getContext("2d")
sc.fillStyle = BG; sc.fillRect(0, 0, PW * 2, 170)
const poses = [
  { pose: 0, up: 0, ears: 0.55, lift: 0, label: "sitting" }, { pose: -1, up: 0, ears: 0.45, lift: 0, label: "gather" },
  { pose: 1, up: 0, ears: 0.4, lift: 5, label: "push off" }, { pose: 0.7, up: 0, ears: 0.4, lift: 9, label: "stretched" },
  { pose: -0.3, up: 0, ears: 0.45, lift: 3, label: "tuck" }, { pose: -0.6, up: 0, ears: 0.5, lift: 0, label: "land" },
  { pose: 0, up: 1, ears: 1, lift: 0, label: "sat up", nose: 0.7 }, { pose: 0, up: 0.2, ears: 0.6, lift: 0, label: "spring coat", coat: "brown" }
]
poses.forEach((p, i) => {
  const cx = 95 + i * 180, gy = 130
  sc.fillStyle = "#e9eef7"; sc.fillRect(cx - 80, gy, 160, 12)
  sc.save(); sc.translate(cx, gy); sc.scale(3.2, 3.2)
  D.drawRabbit(sc, { x: 0, y: -p.lift, dir: 1, pose: p.pose, up: p.up, ears: p.ears, lift: p.lift, nose: p.nose || 0, look: 0, coat: p.coat || "white" })
  sc.restore()
  sc.fillStyle = "rgba(255,255,255,0.85)"; sc.font = "14px sans-serif"; sc.fillText(p.label, cx - 34, 162)
})

const sheet = createCanvas(PW * 2, PH * 2 + 170), ctx = sheet.getContext("2d")
panels.forEach((p, i) => ctx.drawImage(p, (i % 2) * PW, Math.floor(i / 2) * PH))
ctx.drawImage(strip, 0, PH * 2)
ctx.strokeStyle = "#000"; ctx.lineWidth = 2
ctx.beginPath(); ctx.moveTo(PW, 0); ctx.lineTo(PW, PH * 2); ctx.moveTo(0, PH); ctx.lineTo(PW * 2, PH); ctx.moveTo(0, PH * 2); ctx.lineTo(PW * 2, PH * 2); ctx.stroke()
fs.writeFileSync(out, sheet.toBuffer("image/png"))
console.log("wrote", out)
