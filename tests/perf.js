// Frame cost under node: the simulation (always) and the drawing (when
// @napi-rs/canvas is on NODE_PATH), on a 2560x1440 screen with six windows
// at full snow, then with each of the newer features at work.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/perf.js
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const T = load("lib/theme.js")
let createCanvas = null
try { createCanvas = require("@napi-rs/canvas").createCanvas } catch (e) {}

const W = 2560, H = 1440, dt = 1 / 60
const rects = [
  { id: "a", x: 40, y: 300, w: 820, h: 700, floating: false, z: 3 },
  { id: "b", x: 880, y: 220, w: 820, h: 500, floating: false, z: 2 },
  { id: "c", x: 1720, y: 260, w: 800, h: 640, floating: false, z: 4 },
  { id: "d", x: 880, y: 740, w: 820, h: 600, floating: false, z: 5 },
  { id: "e", x: 300, y: 1060, w: 520, h: 300, floating: true, z: 0 },
  { id: "f", x: 1900, y: 980, w: 520, h: 360, floating: true, z: 1 }
]

function scene(setup) {
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  for (let t = 0; t < 60; t += dt) { S.setSurfaces(w, rects, w.time); S.step(w, dt) }
  if (setup) setup(w)
  return w
}

function measure(label, w, frames, each) {
  const ctx = createCanvas ? createCanvas(W, H).getContext("2d") : null
  let sim = 0, draw = 0
  for (let i = 0; i < frames; i++) {
    const list = each ? each(w, i) : rects
    const t0 = process.hrtime.bigint()
    S.setSurfaces(w, list, w.time)
    S.step(w, dt)
    const t1 = process.hrtime.bigint()
    if (ctx) D.world(ctx, w)
    const t2 = process.hrtime.bigint()
    sim += Number(t1 - t0); draw += Number(t2 - t1)
  }
  const row = { label, marks: S.extrasStats(w).marks, sim: +(sim / frames / 1e6).toFixed(3), draw: ctx ? +(draw / frames / 1e6).toFixed(2) : null, particles: w.particles.length }
  console.log(JSON.stringify(row))
  return row
}

const N = 600
const rows = []
rows.push(measure("baseline: full snow, six windows", scene(), N))
D.setTheme(T.derive(T.parse('accent = "#89b4fa"\nbackground = "#1e1e2e"\nred = "#f38ba8"\nblue = "#89b4fa"\ngreen = "#a6e3a1"')))
rows.push(measure("theme colours on", scene(), N))
rows.push(measure("day cycle: icicles on every window, night glaze", scene(w => {
  for (const s of Object.values(w.surfaces)) if (!s.ground) { s.icicles = S.seedIcicles(s); s.icicles.forEach(i => { i.len = i.max }) }
  for (const s of Object.values(w.surfaces)) s.glaze = 0.9
  S.setEnv(w, { freeze: 0.9, drip: 0.6, tempC: 0 })
}), N))
rows.push(measure("writing: about 1500 marks in the ground snow", scene(w => {
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => 18 + 2 * Math.sin(i * 0.05))
  for (let k = 0; k < 15; k++) {
    S.writeStart(w, 100 + k * 150, H - 8)
    for (let x = 0; x < 140; x += 2) S.writeTo(w, 100 + k * 150 + x, H - 8 + Math.sin(x * 0.2) * 5)
    S.writeEnd(w)
  }
}), N))
const flung = (w, i) => rects.map(r => r.id === "e" ? Object.assign({}, r, { x: 300 + 700 * Math.sin(i * 0.05) }) : r)
rows.push(measure("wind: a window flung back and forth (gusts on)", scene(), N, flung))
rows.push(measure("wind: the same with gusts off", scene(w => S.setFeatures(w, { gusts: false })), N, flung))
// A yank every two seconds: window "b" pulled 2400 px/s to the left for
// a quarter second, then put back (a jump, no pointer), and again.
const yanked = (w, i) => rects.map(r => {
  if (r.id !== "b") return r
  const k = i % 120
  return Object.assign({}, r, { x: k < 15 ? r.x - 40 * k : r.x })
})
rows.push(measure("yank: a snowy window pulled out from under its ledge", scene(), N, yanked))
rows.push(measure("shake: the first 10 s after", scene(w => S.shake(w, 1)), N))
rows.push(measure("New Year fireworks", scene(w => { S.startFireworks(w, 60); S.setEnv(w, { snowScale: 0.5 }) }), N))
rows.push(measure("spring: petals and sprouts", scene(w => {
  S.setEnv(w, { spring: 1, petals: 1, sprouts: 1, snowScale: 0 })
  w.sprouts = S.seedSprouts(w); w.sprouts.forEach(p => { p.g = 1 })
}), N))
rows.push(measure("surprises: bird, hare and golden flake at once", scene(w => { S.spawnBird(w); S.spawnRabbit(w); S.spawnGolden(w) }), N))
module.exports = rows
