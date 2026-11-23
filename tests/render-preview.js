// Renders preview frames of each effect and the decorations with
// @napi-rs/canvas, for eyeballing the art outside the shell.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-preview.js out/
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs"), path = require("path")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const out = process.argv[2] || "out"
fs.mkdirSync(out, { recursive: true })

const W = 1280, H = 760
const rects = [
  { id: "a", x: 70, y: 180, w: 520, h: 400, floating: false, z: 1 },
  { id: "b", x: 640, y: 120, w: 560, h: 300, floating: false, z: 2 },
  { id: "c", x: 520, y: 330, w: 380, h: 280, floating: true, z: 0 }
]
function desktop(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#1b2335"); g.addColorStop(1, "#3a4766")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const sorted = rects.slice().sort((a, b) => (a.floating - b.floating) || (b.z - a.z))
  for (const r of sorted) {
    ctx.fillStyle = "#11151f"; ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h)
  }
}
for (const effect of S.EFFECTS) {
  const w = S.createWorld(W, H, { effect, intensity: 1.6, groundInset: 0 })
  const ptr = { x: 300, y: 690, vx: 0, vy: 0, present: true, stillFor: 5 }
  for (let t = 0; t < 45; t += 1 / 60) { S.setSurfaces(w, rects, w.time); S.step(w, 1 / 60, { pointer: ptr }) }
  if (effect === "rain") { w.flash = 0.4; w.bolt = S.makeBolt(w) }
  if (effect === "starfall") { for (let i = 0; i < 4; i++) w.particles.push(S.makeParticle(w)); S.burst(w, 900, 120, 18, [0, 1, 2]) }
  const c = createCanvas(W, H), ctx = c.getContext("2d")
  desktop(ctx)
  const layer = createCanvas(W, H), lctx = layer.getContext("2d")
  D.world(lctx, w)
  ctx.drawImage(layer, 0, 0)
  fs.writeFileSync(path.join(out, effect + ".png"), c.toBuffer("image/png"))
  console.log(effect, JSON.stringify(S.stats(w)))
}
// Decorations sheet.
const c = createCanvas(1000, 300), ctx = c.getContext("2d")
ctx.fillStyle = "#2a3550"; ctx.fillRect(0, 0, 1000, 300)
function put(x, y, w, h, fn) { const t = createCanvas(w, h); fn(t.getContext("2d"), w, h); ctx.drawImage(t, x, y) }
put(10, 120, 90, 160, (g, w, h) => D.snowman(g, w, h, {}))
put(110, 60, 160, 230, (g, w, h) => D.tree(g, w, h, { growth: 1, star: true, ornaments: [
  { kind: "bauble", u: -0.5, v: 0.6, color: "#e74c3c" }, { kind: "bauble", u: 0.4, v: 0.8, color: "#3498db" },
  { kind: "light", u: 0.1, v: 0.3, color: "#ffd84d" }, { kind: "light", u: -0.6, v: 0.9, color: "#ff6b6b" },
  { kind: "candy", u: 0.5, v: 0.45 }] }, 1))
put(290, 30, 300, 110, (g, w, h) => D.sleigh(g, w, h, 0.3))
put(600, 120, 130, 170, (g, w, h) => D.yeti(g, w, h, 0.2, 1, true, false))
put(740, 200, 180, 80, (g, w, h) => D.train(g, w, h, 0.4, 1, "snowman"))
put(300, 200, 60, 60, (g, w, h) => D.gift(g, w, h, "#2e86de"))
put(380, 210, 60, 50, (g, w, h) => D.letter(g, w, h))
fs.writeFileSync(path.join(out, "decorations.png"), c.toBuffer("image/png"))
