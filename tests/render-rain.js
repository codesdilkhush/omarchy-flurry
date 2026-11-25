// Renders the rain: a still after it has been raining a while, and with
// FRAMES=dir a run of frames (one window dragged across midway) for a video.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-rain.js out.png [secs] [draw.js]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs"), path = require("path")
const load = require("./load")
const S = load("lib/sim.js")
const D = load(process.argv[4] || "lib/draw.js")
const out = process.argv[2] || "rain.png"
const secs = +(process.argv[3] || 6)
const W = 1280, H = 720
const rects = [
  { id: "a", x: 70, y: 260, w: 470, h: 340, floating: false, z: 1 },
  { id: "b", x: 600, y: 140, w: 560, h: 250, floating: false, z: 2 },
  { id: "c", x: 700, y: 470, w: 380, h: 180, floating: true, z: 0 }
]
function desktop(ctx, rs) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#26304a"); g.addColorStop(1, "#4a5a7e")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const sorted = rs.slice().sort((a, b) => (a.floating - b.floating) || (b.z - a.z))
  for (const r of sorted) {
    ctx.fillStyle = "#11151f"; ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = "#9ece6a"; ctx.font = "14px monospace"; ctx.fillText("~ ❯ ", r.x + 10, r.y + 22)
  }
}
const w = S.createWorld(W, H, { effect: "rain", intensity: 1.3, groundInset: 0 })
const ptr = { x: 300, y: 690, vx: 0, vy: 0, present: false, stillFor: 5 }
for (let t = 0; t < 12; t += 1 / 60) { S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, { pointer: ptr }) }
const frames = process.env.FRAMES
if (frames) fs.mkdirSync(frames, { recursive: true })
const c = createCanvas(W, H), ctx = c.getContext("2d")
const lay = createCanvas(W, H), lctx = lay.getContext("2d")
const n = Math.round(secs * 60)
for (let f = 0; f < n; f++) {
  const t = f / 60
  const rs = rects.map(r => ({ ...r }))
  // Window c is moved slowly left and back in the middle of the run.
  if (t > secs * 0.4 && t < secs * 0.8) rs[2].x = 700 - 260 * Math.sin(Math.PI * (t - secs * 0.4) / (secs * 0.4))
  if (f === Math.round(n * 0.25)) { w.flash = 0.8; w.bolt = S.makeBolt(w) }
  S.setSurfaces(w, rs, w.time)
  S.step(w, 1 / 60, { pointer: ptr })
  if (!frames && f < n - 1) continue
  desktop(ctx, rs)
  lctx.clearRect(0, 0, W, H)
  D.world(lctx, w)
  ctx.drawImage(lay, 0, 0)
  if (frames) fs.writeFileSync(path.join(frames, "f" + String(f).padStart(4, "0") + ".png"), c.toBuffer("image/png"))
}
fs.writeFileSync(out, c.toBuffer("image/png"))
console.log(JSON.stringify(S.stats(w)), Object.keys(w.faults || {}))
