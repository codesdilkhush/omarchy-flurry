// A window yanked sideways out from under its snow, as a frame strip: the
// snowy window at rest, the frame of the yank, then the snow falling where
// the window was while the window is already gone sideways. Samples reach
// the world the way the shell sees a drag: the pointer on the title bar, the
// first sample after the pointer poll, then every frame.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-yank.js out.png [px/s]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "yank.png"
const V = +(process.argv[3] || 2400)

const W = 1920, H = 1080, dt = 1 / 60
// The crop each panel shows, and its scale.
const CX = 240, CY = 170, CW = 1440, CH = 910, K = 0.6, PW = CW * K, PH = CH * K
const term = { id: "0x55d1c0a3e2f0", x: 640, y: 380, w: 760, h: 420, floating: true, z: 0 }

function wallpaper(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#22304f"); g.addColorStop(0.6, "#3b4f78"); g.addColorStop(1, "#56688f")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}
function terminal(ctx, r) {
  ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2)
  ctx.fillStyle = "#9ece6a"; ctx.font = "20px monospace"; ctx.fillText("~ ❯ ", r.x + 16, r.y + 34)
}
function ghost(ctx, r) {
  ctx.setLineDash([10, 8]); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2
  ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([])
}
function shot(w, r, label, was) {
  const c = createCanvas(PW, PH), ctx = c.getContext("2d")
  ctx.save(); ctx.scale(K, K); ctx.translate(-CX, -CY)
  wallpaper(ctx); if (was) ghost(ctx, was); if (r) terminal(ctx, r)
  ctx.restore()
  // The overlay is its own transparent layer over the desktop, as in the shell.
  const layer = createCanvas(PW, PH), l = layer.getContext("2d")
  l.scale(K, K); l.translate(-CX, -CY); D.world(l, w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "rgba(10,10,20,0.65)"; ctx.fillRect(0, PH - 28, PW, 28)
  ctx.fillStyle = "#fff"; ctx.font = "15px sans-serif"; ctx.fillText(label, 10, PH - 9)
  return c
}

const w = S.createWorld(W, H, { effect: "snow", intensity: 1.3, plow: false })
S.setEnv(w, { tempC: -5, icicle: 1 })
const hint = (r, moving) => ({ pointer: { x: r.x + 380, y: r.y + 14, vx: moving ? -V : 0, vy: 0, present: true, stillFor: moving ? 0 : 2 },
                               poll: moving ? 0.016 : 0.2, layoutAge: 30 })
for (let t = 0; t < 150; t += dt) { S.setSurfaces(w, [term], w.time, [term.id], hint(term, false)); S.step(w, dt) }
// Let the last flakes land, so only the ledge moves in the strip.
S.setEnv(w, { snowScale: 0 })
for (let t = 0; t < 6; t += dt) { S.setSurfaces(w, [term], w.time, [term.id], hint(term, false)); S.step(w, dt) }
const frames = []
frames.push(shot(w, term, "1. at rest: a ledge of snow and icicles"))
// The yank: left at V px/s; the first sample arrives after the pointer poll.
let x = term.x, f = 0
const keep = { 1: "2. the yank frame: the window is pulled out, the ledge breaks", 3: "3. +2 frames", 8: "4. +7 frames (0.12 s)",
               16: "5. +15 frames (0.25 s)", 30: "6. +29 frames (0.48 s): it all fell where the window was" }
for (; f <= 30; f++) {
  if (f >= 1) x -= V * (f === 1 ? 0.05 : dt)
  const r = Object.assign({}, term, { x })
  S.setSurfaces(w, [r], w.time, [term.id], hint(r, f >= 1))
  S.step(w, dt)
  if (keep[f]) frames.push(shot(w, r, keep[f], term))
}
const sheet = createCanvas(PW * 2 + 6, PH * 3 + 12), sc = sheet.getContext("2d")
sc.fillStyle = "#0b0b12"; sc.fillRect(0, 0, sheet.width, sheet.height)
frames.forEach((fr, i) => sc.drawImage(fr, (i % 2) * (PW + 6), Math.floor(i / 2) * (PH + 6)))
fs.writeFileSync(out, sheet.toBuffer("image/png"))
const air = w.particles.filter(p => p.kind === "clump" || p.kind === "powder")
console.log("wrote", out, "| pieces in the air:", air.length, "| still held:", air.filter(p => p.hold).length,
            "| on the window:", w.surfaces[term.id].bins.reduce((a, b) => a + b, 0).toFixed(1))
