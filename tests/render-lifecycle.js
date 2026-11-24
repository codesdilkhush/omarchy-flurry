// The reported scenario, end to end: a terminal on a 1920x1080 screen
// collects snow, is dragged about several times (sampled the way the shell
// samples it: the pointer poll first, then every frame, with a late reply
// now and then), and is closed. Six frames, to show the snow riding the
// window and nothing left behind where it was.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-lifecycle.js out.png
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "lifecycle.png"

const W = 1920, H = 1080, dt = 1 / 60, PW = 640, PH = 360
const term = { id: "0x55d1c0a3e2f0", x: 520, y: 330, w: 880, h: 470, floating: true, z: 0 }

function wallpaper(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#5b2a73"); g.addColorStop(0.55, "#c4457f"); g.addColorStop(1, "#f08aa0")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = "rgba(20,14,30,0.55)"; ctx.fillRect(0, 0, W, 26)   // the bar
}
function terminal(ctx, r) {
  ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2)
  ctx.fillStyle = "#9ece6a"; ctx.font = "20px monospace"; ctx.fillText("~ ❯ ", r.x + 16, r.y + 34)
}
function shot(w, r, label) {
  const k = PW / W
  const c = createCanvas(PW, PH), ctx = c.getContext("2d")
  ctx.save(); ctx.scale(k, k); wallpaper(ctx); if (r) terminal(ctx, r); ctx.restore()
  const layer = createCanvas(PW, PH), l = layer.getContext("2d")
  l.scale(k, k); D.world(l, w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "rgba(10,10,20,0.6)"; ctx.fillRect(0, PH - 26, PW, 26)
  ctx.fillStyle = "#fff"; ctx.font = "14px sans-serif"; ctx.fillText(label, 10, PH - 9)
  return c
}

const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false, groundInset: 0 })
S.setEnv(w, { tempC: -5, icicle: 0.55 })
let rect = Object.assign({}, term), shown = Object.assign({}, term)
const frames = []
// Runs the world for `secs` while the window follows path(t) -> {x, y}
// (null: it holds still). Samples reach the world as the shell would see
// them: nothing for the first 50 ms of a move (the pointer poll), then
// every frame, one in eight a frame late.
function run(secs, path, alive) {
  let since = -1
  for (let t = 0; t < secs; t += dt) {
    if (path) {
      const p = path(t)
      rect.x = p.x; rect.y = p.y
      since = since < 0 ? 0 : since + dt
      if (since >= 0.05 && Math.random() > 0.125) shown = Object.assign({}, rect)
    }
    const list = alive === false ? [] : [shown]
    S.setSurfaces(w, list, w.time, alive === false ? [] : [term.id])
    S.step(w, dt)
  }
}
const ease = u => u < 0 ? 0 : (u > 1 ? 1 : u * u * (3 - 2 * u))

run(150, null)
frames.push(shot(w, shown, "1. 2.5 min of snow: a soft ledge, icicles under the window"))
// Drag 1: a calm move to the left and up.
const a0 = { x: shown.x, y: shown.y }
run(0.7, t => ({ x: a0.x - 360 * ease(t / 1.2), y: a0.y - 90 * ease(t / 1.2) }))
frames.push(shot(w, shown, "2. mid-drag (~450 px/s): the ledge rides with the window"))
run(0.5, t => ({ x: a0.x - 360 * ease((t + 0.7) / 1.2), y: a0.y - 90 * ease((t + 0.7) / 1.2) }))
run(1.5, null)
frames.push(shot(w, shown, "3. dropped: nothing left where it was"))
// Drag 2: a brisk fling right and down, and a hard stop.
const b0 = { x: shown.x, y: shown.y }
run(0.32, t => ({ x: b0.x + 700 * ease(t / 0.45), y: b0.y + 160 * ease(t / 0.45) }))
frames.push(shot(w, shown, "4. a fling (~2000 px/s, ~13 g): a yank, the ledge falls where it was"))
run(0.13, t => ({ x: b0.x + 700 * ease((t + 0.32) / 0.45), y: b0.y + 160 * ease((t + 0.32) / 0.45) }))
// Drag 3 and 4: back and forth.
for (let k = 0; k < 2; k++) {
  const c0 = { x: shown.x, y: shown.y }
  run(0.9, t => ({ x: c0.x + (k ? 260 : -420) * ease(t / 0.9), y: c0.y + (k ? -50 : 30) * ease(t / 0.9) }))
  run(0.6, null)
}
const last = Object.assign({}, shown)
// Closed.
run(0.25, null, false)
frames.push(shot(w, null, "5. closed: the ledge falls as loose clumps at once"))
run(3, null, false)
frames.push(shot(w, null, "6. 3 s later: no ghost ledge, no floating snow"))

const sheet = createCanvas(PW * 2 + 6, PH * 3 + 12), sc = sheet.getContext("2d")
sc.fillStyle = "#0b0b12"; sc.fillRect(0, 0, sheet.width, sheet.height)
frames.forEach((f, i) => sc.drawImage(f, (i % 2) * (PW + 6), Math.floor(i / 2) * (PH + 6)))
fs.writeFileSync(out, sheet.toBuffer("image/png"))
const left = w.particles.filter(p => (p.kind === "clump" || p.kind === "powder") && p.y < H - 40).length
console.log("wrote", out, "| surfaces:", Object.keys(w.surfaces).join(","), "| stash:", Object.keys(w.stash).length, "| loose snow in the air:", left, "| last rect", last.x | 0, last.y | 0)
