// Renders a filmstrip of a snowy window being flung and stopped, for
// eyeballing the snow physics outside the shell.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-physics.js out.png
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "physics.png"

const W = 900, H = 520, dt = 1 / 60
const base = { id: "a", x: 120, y: 200, w: 360, h: 220, floating: true, z: 0 }
const back = { id: "b", x: 470, y: 150, w: 330, h: 250, floating: false, z: 1 }
const w = S.createWorld(W, H, { effect: "snow", intensity: 2 })
for (let t = 0; t < 70; t += dt) { S.setSurfaces(w, [base, back], w.time); S.step(w, dt) }
S.setIntensity(w, 0.4)

// Fling right 260 px over 0.16 s, then stop dead.
const offset = t => t < 0.3 ? 0 : (t < 0.46 ? 260 * (t - 0.3) / 0.16 : 260)
const shots = [0.29, 0.38, 0.47, 0.55, 0.7, 1.1, 2.0]
const strip = createCanvas(W, H * shots.length), sctx = strip.getContext("2d")
let t = 0, k = 0
while (k < shots.length) {
  const r = Object.assign({}, base, { x: base.x + offset(t) })
  S.setSurfaces(w, [r, back], w.time)
  S.step(w, dt)
  t += dt
  if (t >= shots[k]) {
    const c = createCanvas(W, H), ctx = c.getContext("2d")
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, "#1b2335"); g.addColorStop(1, "#3a4766")
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    for (const q of [back, r]) {
      ctx.fillStyle = "#11151f"; ctx.fillRect(q.x, q.y, q.w, q.h)
      ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(q.x, q.y, q.w, q.h)
    }
    const layer = createCanvas(W, H)
    D.world(layer.getContext("2d"), w)
    ctx.drawImage(layer, 0, 0)
    ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif"
    ctx.fillText(`t = ${shots[k].toFixed(2)} s   ${JSON.stringify(S.stats(w).kinds)}`, 12, 22)
    sctx.drawImage(c, 0, H * k)
    k++
  }
}
fs.writeFileSync(out, strip.toBuffer("image/png"))
