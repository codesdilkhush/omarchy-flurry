// How snow gathers on window tops, and how icicles come in under them, as
// it falls on an empty desktop: a strip of stills from the first flakes to
// a deep ledge. Checks by eye that a thin layer lies in patches and drifts
// (never as an even line along the edge) and that icicles hang one by one
// (no band of ice drawn along the bottom edge).
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-accumulate.js out.png [simPath] [drawPath] [label]
"use strict"
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load(process.argv[3] || "lib/sim.js"), D = load(process.argv[4] || "lib/draw.js")
const out = process.argv[2] || "accumulate.png", label = process.argv[5] || ""
const W = 1920, H = 1080, dt = 1 / 30, CROP = { x: 220, y: 200, w: 1100, h: 420 }
const wins = [{ id: "0xa", x: 300, y: 300, w: 840, h: 220, floating: true, z: 0 }, { id: "0xb", x: 700, y: 560, w: 560, h: 200, floating: false, z: 3 }]
// Seeded randomness, so before and after see the same snowfall.
let seed = 12345
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const w = S.createWorld(W, H, { effect: "snow", intensity: 2, plow: false })
S.setFeatures(w, { icicles: true, border: 2 })
const rest = { x: 50, y: 50, vx: 0, vy: 0, present: true, stillFor: 9, age: 0 }
const shots = [], at = [4, 12, 30, 70, 150]
let t = 0
for (const stop of at) {
  for (; t < stop; t += dt) { S.setSurfaces(w, wins, w.time, wins.map(r => r.id), { pointer: rest, poll: 0.2, layoutAge: 30 }); S.step(w, dt, { pointer: rest }) }
  shots.push([`${stop} s of snow`, snap()])
}
// A cold night: icicles.
S.setEnv(w, { snowScale: 0.3, tempC: -6, icicle: 2.5 })
for (let k = 0; k < 2; k++) {
  for (let e = 0; e < 40; e += dt) { S.setSurfaces(w, wins, w.time, wins.map(r => r.id), { pointer: rest, poll: 0.2, layoutAge: 30 }); S.step(w, dt, { pointer: rest }) }
  shots.push([`cold night, +${40 * (k + 1)} s`, snap()])
}
function snap() {
  const c = createCanvas(CROP.w, CROP.h), ctx = c.getContext("2d")
  ctx.translate(-CROP.x, -CROP.y)
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#4a2a6e"); g.addColorStop(0.5, "#d9578a"); g.addColorStop(1, "#2e2a62")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  for (const r of [...wins].reverse()) { ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2) }
  const l = createCanvas(W, H); D.world(l.getContext("2d"), w)
  ctx.drawImage(l, 0, 0)
  return c
}
const sheet = createCanvas(CROP.w, (CROP.h + 30) * shots.length), sc = sheet.getContext("2d")
sc.fillStyle = "#0b0b12"; sc.fillRect(0, 0, sheet.width, sheet.height)
shots.forEach(([name, c], i) => {
  sc.drawImage(c, 0, i * (CROP.h + 30) + 30)
  sc.fillStyle = "#ffd27a"; sc.font = "18px sans-serif"; sc.fillText(label + "  " + name, 10, i * (CROP.h + 30) + 21)
})
fs.writeFileSync(out, sheet.toBuffer("image/png"))
console.log("wrote", out)
