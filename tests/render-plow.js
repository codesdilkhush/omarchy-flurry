// Renders the snow plow at work: snow builds up on the ground until the
// plow comes out, then frames of its pass, plus a close-up.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-plow.js out.png [closeup.png]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "plow.png"
const closeOut = process.argv[3]

const W = 1280, H = 720, dt = 1 / 60
const wins = [
  { id: "a", x: 140, y: 120, w: 460, h: 300, floating: false, z: 1 },
  { id: "b", x: 700, y: 90, w: 420, h: 360, floating: false, z: 0 }
]
const w = S.createWorld(W, H, { effect: "snow", intensity: 2 })
S.setSurfaces(w, wins, 0)
let guard = 0
while (!w.plow && guard++ < 60 * 60 * 20) S.step(w, dt)
console.log("plow out at", w.time.toFixed(1), "s", JSON.stringify(S.stats(w)))

function paint() {
  const c = createCanvas(W, H), ctx = c.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1b2335"); g.addColorStop(1, "#3a4766")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  for (const q of wins) {
    ctx.fillStyle = "#11151f"; ctx.fillRect(q.x, q.y, q.w, q.h)
    ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(q.x, q.y, q.w, q.h)
  }
  const layer = createCanvas(W, H)
  D.world(layer.getContext("2d"), w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif"
  const st = S.stats(w)
  ctx.fillText(`t = ${w.time.toFixed(1)} s   ground fill ${st.groundFill}   ${JSON.stringify(st.plow)}`, 12, 22)
  return c
}

const start = w.time
const shots = [1.5, 4, 7, 10]
const frames = []
let k = 0, close = null
while (w.plow || k < shots.length) {
  S.step(w, dt)
  if (k < shots.length && w.time - start >= shots[k]) { frames.push(paint()); k++ }
  if (!close && w.plow && w.plow.x > W * 0.55) close = closeUp(w.plow.x)
  if (w.time - start > 60) break
}
frames.push(paint())
console.log("done at", (w.time - start).toFixed(1), "s after start", JSON.stringify(S.stats(w)))
const strip = createCanvas(W, H * frames.length), sctx = strip.getContext("2d")
frames.forEach((f, i) => sctx.drawImage(f, 0, H * i))
fs.writeFileSync(out, strip.toBuffer("image/png"))
if (closeOut && close) fs.writeFileSync(closeOut, close.toBuffer("image/png"))

// The plow at twice the size, from a fresh paint (not an upscaled one).
function closeUp(x) {
  const Z = 2.5, cw = 1400, ch = 520
  const c = createCanvas(cw, ch), ctx = c.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, ch)
  g.addColorStop(0, "#26304a"); g.addColorStop(1, "#3a4766")
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch)
  const layer = createCanvas(cw, ch), lc = layer.getContext("2d")
  lc.scale(Z, Z)
  lc.translate(-(x - 300), -(H - ch / Z + 14))
  D.world(lc, w)
  ctx.drawImage(layer, 0, 0)
  return c
}
