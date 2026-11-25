// Renders the hare's visit to PNG frames: node tests/render-hare.js outDir [seconds]
const load = require("./load")
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const S = load("lib/sim.js"), D = load("lib/draw.js")
const out = process.argv[2] || "/tmp/hare", secs = +(process.argv[3] || 14)
fs.mkdirSync(out, { recursive: true })
const W = 900, H = 300, dt = 1 / 60
const w = S.createWorld(W, H, { effect: "snow", intensity: 0.4, plow: false })
for (let t = 0; t < 2; t += dt) { S.setSurfaces(w, [], w.time); S.step(w, dt) }
const g = w.surfaces.__ground
g.bins = g.bins.map((v, i) => 10 + 2 * Math.sin(i * 0.1))
S.spawnRabbit(w, { dir: 1 })
w.rabbit.stay = secs * 0.7
const wc = createCanvas(W, H), wctx = wc.getContext("2d")
const Z = 3, ZW = 300, ZH = 70
const c = createCanvas(W, H + ZH * Z), ctx = c.getContext("2d")
let cx = 150
let f = 0
for (let t = 0; t < secs && w.rabbit; t += dt) {
  S.setSurfaces(w, [], w.time); S.step(w, dt)
  if (Math.round(t / dt) % 2) continue
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#2a3350"); bg.addColorStop(1, "#5a6890")
  ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H + ZH * Z)
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  D.world(wctx, w)
  ctx.drawImage(wc, 0, 0)
  // A close-up that follows the hare, below.
  if (w.rabbit) cx += (Math.max(ZW / 2, Math.min(W - ZW / 2, w.rabbit.x)) - cx) * 0.08
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(c, cx - ZW / 2, H - ZH, ZW, ZH, 0, H, ZW * Z, ZH * Z)
  ctx.fillStyle = "#fff"; ctx.font = "14px sans-serif"
  ctx.fillText((w.rabbit ? w.rabbit.mode + (w.rabbit.mode === "rest" ? " · " + w.rabbit.act : "") : "gone") + "  t=" + t.toFixed(1) + "s", 10, 20)
  fs.appendFileSync(`${out}/modes.txt`, f + " " + (w.rabbit ? w.rabbit.mode + ":" + w.rabbit.act : "-") + "\n")
  fs.writeFileSync(`${out}/f${String(f++).padStart(4, "0")}.png`, c.toBuffer("image/png"))
}
console.log("frames", f)
