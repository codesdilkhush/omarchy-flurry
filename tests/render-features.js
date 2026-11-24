// Renders a contact sheet of the seasonal and surprise features: icicles
// and the night glaze, writing in the snow, a bird on a ledge, a hare and its
// tracks, New Year fireworks between the windows, spring sprouts and
// blossom, a snowman being dressed, the bauble finishes and the golden
// snowflake, a snow globe shake, and the wind off a flung window. Painted
// with a real Omarchy theme's colours (catppuccin), as the theme sync does.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-features.js out.png [colors.toml]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs"), path = require("path")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const T = load("lib/theme.js")
const out = process.argv[2] || "features.png"
const themeFile = process.argv[3]

const palette = themeFile && fs.existsSync(themeFile) ? T.parse(fs.readFileSync(themeFile, "utf8")) : T.parse(CATPPUCCIN())
const theme = T.derive(palette)
D.setTheme(theme)

const W = 640, H = 360, dt = 1 / 60
const run = (w, rects, secs, each) => { for (let t = 0; t < secs - 1e-9; t += dt) { S.setSurfaces(w, rects, w.time); if (each) each(t); S.step(w, dt) } }

function desktop(ctx, rects, crop) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, palette.background); g.addColorStop(1, mix(palette.background, palette.blue, 0.22))
  ctx.fillStyle = g; ctx.fillRect(crop[0], crop[1], crop[2], crop[3])
  const sorted = rects.slice().sort((a, b) => (a.floating - b.floating) || (b.z - a.z))
  for (const r of sorted) {
    ctx.fillStyle = mix(palette.background, "#000000", 0.25); ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = palette.accent; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = mix(palette.foreground, palette.background, 0.35); ctx.font = "12px monospace"
    ctx.fillText(r.label || "~ $", r.x + 12, r.y + 22)
  }
}
function mix(a, b, t) { return T.mixHex(a, b, t) }

// One frame: the desktop, the world over it, zoomed in on (cx, cy).
function paint(w, rects, label, zoom, extra) {
  zoom = zoom || { x: W / 2, y: H / 2, k: 1 }
  const scale = zoom.k
  const crop = [zoom.x - W / scale / 2, zoom.y - H / scale / 2, W / scale, H / scale]
  const c = createCanvas(W, H), ctx = c.getContext("2d")
  ctx.save(); ctx.scale(scale, scale); ctx.translate(-crop[0], -crop[1])
  desktop(ctx, rects, crop)
  if (extra) extra(ctx)
  ctx.restore()
  // The scene is painted at the zoomed resolution, not scaled up after.
  const layer = createCanvas(W, H), lctx = layer.getContext("2d")
  lctx.scale(scale, scale); lctx.translate(-crop[0], -crop[1])
  D.world(lctx, w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.font = "15px sans-serif"
  ctx.fillText(label, 14, 26)
  return c
}

function snowy(rects, secs, opts) {
  const w = S.createWorld(W, H, Object.assign({ effect: "snow", intensity: 1.6, plow: false }, opts || {}))
  run(w, rects, secs || 30)
  return w
}
function settle(w, depth, wobble) {
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => depth + (wobble || 3) * Math.sin(i * 0.05) + 1.4 * Math.sin(i * 0.17 + 1))
  for (const s of Object.values(w.surfaces)) s.pack = 0.8
}
function clearSky(w) { w.particles = w.particles.filter(p => p.kind !== "flake") }

const frames = []

// 1. Icicles and the night glaze, a drop of meltwater falling.
{
  const win = { id: "ice", x: 150, y: 70, w: 340, h: 150, z: 0, label: "~ $ nvim notes.md" }
  const w = snowy([win], 40)
  settle(w, 12)
  const s = w.surfaces.ice
  s.bins = s.bins.map((v, i) => Math.max(v, 7 + 2 * Math.sin(i * 0.1)))
  s.icicles = S.seedIcicles(s)
  s.icicles.forEach((ic, i) => { ic.len = ic.max * (0.55 + 0.45 * ((i * 37) % 10) / 10) })
  S.setEnv(w, { drip: 1, freeze: 1, tempC: -0.5 })
  for (const q of Object.values(w.surfaces)) q.glaze = 0.85
  s.icicles[3].drip = 0.01
  run(w, [win], 0.18)
  S.setEnv(w, { freeze: 1, tempC: -3 })
  w.particles = w.particles.filter(p => p.kind !== "flake" || Math.random() < 0.35)
  frames.push(paint(w, [win], "Icicles, a drop of meltwater, and the night glaze", { x: 320, y: 158, k: 1.45 }))
}

// 2. Writing in the ground snow.
{
  const w = snowy([], 4)
  settle(w, 21, 1.5)
  clearSky(w)
  writeText(w, "let it snow", 170, H - 5, 2.2)
  run(w, [], 0.2)
  frames.push(paint(w, [], "Ctrl+drag writes in the snow", { x: 268, y: H - 22, k: 2.9 }))
}

// 3. A bird on a snowy ledge, its footprints and pecks.
{
  const win = { id: "ledge", x: 120, y: 160, w: 400, h: 200, z: 0, label: "~ $ htop" }
  const w = snowy([win], 40)
  settle(w, 10)
  const s = w.surfaces.ledge
  s.bins = s.bins.map((v, i) => Math.max(v, 8 + 2.5 * Math.sin(i * 0.08)))
  S.spawnBird(w)
  const B = w.bird
  B.s = "ledge"; B.ox = 230; B.facing = -1
  run(w, [win], 3.2)
  if (w.bird) { w.bird.mode = "perch"; w.bird.act = "peck"; w.bird.actT = 0.16; w.bird.peck = 0.9; w.bird.stay = 99 }
  run(w, [win], 1 / 60)
  clearSky(w)
  frames.push(paint(w, [win], "A bird lands, hops and pecks", { x: 350, y: 150, k: 4 }))
}

// 4. A hare hops along the ground snow and leaves its tracks.
{
  const w = snowy([], 4)
  settle(w, 16, 2)
  clearSky(w)
  S.spawnRabbit(w, { dir: 1 })
  w.rabbit.stay = 1e9
  S.setEnv(w, { snowScale: 0.15 })
  run(w, [], 7.2)
  clearSky(w)
  frames.push(paint(w, [], "A hare hops across the snow, leaving its tracks", { x: w.rabbit ? w.rabbit.x - 60 : 290, y: H - 50, k: 2.6 }))
}

// 5. New Year: fireworks between and behind the windows.
{
  const rects = [
    { id: "f1", x: 30, y: 150, w: 260, h: 190, z: 1, label: "~ $ date" },
    { id: "f2", x: 330, y: 110, w: 280, h: 230, z: 0, label: "~ $ " }
  ]
  const w = snowy(rects, 20, { intensity: 0.6 })
  S.startFireworks(w, 60)
  w.fw.next = 99
  const shell = (x, y, hue) => {
    w.particles.push({ kind: "rocket", x, y, px: x, py: y, vx: 0, vy: -20, g: 600, life: 6, age: 0, rest: null, hue, k: H / 1080 * 2.6 })
  }
  shell(305, 70, 0); shell(130, 95, 1)
  run(w, rects, 0.7)
  shell(470, 60, 2)
  run(w, rects, 0.35)
  frames.push(paint(w, rects, "New Year: fireworks in the gaps between windows"))
}

// 6. Nowruz: the snow has thinned, sprouts are up, blossom drifts down.
{
  const win = { id: "sp", x: 160, y: 120, w: 320, h: 150, z: 0, label: "~ $ " }
  const w = snowy([win], 4, { intensity: 0.3 })
  const g = w.surfaces.__ground
  g.bins = g.bins.map((v, i) => Math.max(0, 3.2 * Math.sin(i * 0.07) + 1.5 * Math.sin(i * 0.23 + 2) - 0.6))
  w.surfaces.sp.bins = w.surfaces.sp.bins.map((v, i) => Math.max(0, 1.6 * Math.sin(i * 0.09 + 1)))
  S.setEnv(w, { spring: 1, petals: 1, sprouts: 1, snowScale: 0, tempC: 12 })
  clearSky(w)
  w.sprouts = S.seedSprouts(w)
  w.sprouts.forEach((p, i) => { p.g = 0.6 + 0.4 * ((i * 7) % 5) / 5 })
  for (let i = 0; i < 26; i++) { const p = S.makeBlossom(w); p.y = Math.random() * (H - 40); w.particles.push(p) }
  run(w, [win], 6)
  for (let i = 0; i < 14; i++) { const p = S.makeBlossom(w); p.y = Math.random() * (H - 60); w.particles.push(p) }
  run(w, [win], 0.5)
  frames.push(paint(w, [win], "Nowruz: the snow melts, sprouts come up, blossom falls", { x: 330, y: 228, k: 1.35 }))
}

// 7. Dressing a snowman, one click at a time.
{
  const w = snowy([], 4)
  settle(w, 14, 1.5)
  clearSky(w)
  const fits = [{}, { nose: true }, { nose: true, scarf: true }, { nose: true, scarf: true, hat: true }]
  frames.push(paint(w, [], "Click a snowman to dress it (scarf in the theme's colour)", null, ctx => {
    fits.forEach((fit, i) => {
      const t = createCanvas(74, 128)
      D.snowman(t.getContext("2d"), 74, 128, { built: 1, outfit: fit, themeScarf: true })
      const x = 95 + i * 130
      ctx.drawImage(t, x, H - 14 - 128 + 3, 74 * 1.15, 128 * 1.15 - 2)
    })
  }))
}

// 8. The golden snowflake, and the bauble finishes it unlocks.
{
  const w = snowy([], 4)
  settle(w, 12, 1.5)
  clearSky(w)
  S.spawnGolden(w)
  const gold = w.golden
  gold.x = 470; gold.y = 120
  w.golden = null
  const styles = ["glass", "frosted", "pearl", "gilded", "mercury"]
  const colors = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6", "#2ecc71"]
  frames.push(paint(w, [], "Catch the golden snowflake: a new bauble finish", null, ctx => {
    styles.forEach((st, i) => {
      const x = 90 + i * 72, y = 250
      ctx.strokeStyle = "rgba(220,210,170,0.5)"; ctx.lineWidth = 0.8
      ctx.beginPath(); ctx.moveTo(x, 150); ctx.lineTo(x, y - 30); ctx.stroke()
      D.bauble(ctx, x, y, 22, colors[i], i, st)
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "11px sans-serif"
      ctx.fillText(st, x - ctx.measureText(st).width / 2, y + 42)
    })
    ctx.save(); ctx.translate(470, 120); ctx.scale(2.2, 2.2); ctx.translate(-470, -120)
    D.drawGolden(ctx, gold, 0.6)
    ctx.restore()
  }))
}

// 9. Snow globe shake: everything lifted and turning over.
{
  const rects = [
    { id: "g1", x: 40, y: 140, w: 260, h: 200, z: 1, label: "~ $ flurry shake" },
    { id: "g2", x: 340, y: 100, w: 260, h: 240, z: 0, label: "~ $ " }
  ]
  const w = snowy(rects, 50, { intensity: 2 })
  settle(w, 14)
  w.particles = []
  S.shake(w, 1.2)
  run(w, rects, 2.3)
  frames.push(paint(w, rects, "flurry shake: the snow lifts, swirls and settles again"))
}

// 10. Wind off a flung window.
{
  const base = { id: "fl", x: 60, y: 120, w: 240, h: 170, z: 0, floating: true, label: "~ $ " }
  const w = S.createWorld(W, H, { effect: "snow", intensity: 2, plow: false })
  run(w, [base], 40)
  let x = base.x
  for (let t = 0; t < 0.42; t += dt) {
    x += 760 * dt
    S.setSurfaces(w, [Object.assign({}, base, { x })], w.time)
    S.step(w, dt)
  }
  frames.push(paint(w, [Object.assign({}, base, { x })], "A flung window sheds its snow and drags the air along"))
}

const cols = 2
const sheet = createCanvas(cols * W, Math.ceil(frames.length / cols) * H)
const sctx = sheet.getContext("2d")
frames.forEach((f, i) => {
  sctx.drawImage(f, (i % cols) * W, Math.floor(i / cols) * H)
  sctx.strokeStyle = "rgba(0,0,0,0.6)"; sctx.lineWidth = 2
  sctx.strokeRect((i % cols) * W, Math.floor(i / cols) * H, W, H)
})
fs.writeFileSync(out, sheet.toBuffer("image/png"))
if (process.env.FRAMES) frames.forEach((f, i) => fs.writeFileSync(path.join(process.env.FRAMES, "f" + (i + 1) + ".png"), f.toBuffer("image/png")))
console.log("wrote", out, frames.length, "frames")

// ------------------------------------------------------------- a stroke font
//
// Lowercase strokes on a 6-unit grid, written into the snow the way the
// pointer would: start, drag through the points, end.
function writeText(w, text, x0, base, k) {
  const glyphs = {
    l: { w: 1, s: [[[0.3, 6], [0.3, 0.8], [1, 0]]] },
    e: { w: 3, s: [[[0, 1.9], [3, 1.9], [3, 2.6], [2.3, 3.6], [0.8, 3.6], [0, 2.6], [0, 1], [0.8, 0], [2.7, 0.1]]] },
    t: { w: 2.4, s: [[[1, 5.2], [1, 0.7], [1.6, 0], [2.4, 0.1]], [[0, 3.6], [2.3, 3.6]]] },
    i: { w: 0.8, s: [[[0.4, 0], [0.4, 3.6]], [[0.4, 4.9], [0.45, 5.1]]] },
    s: { w: 3, s: [[[3, 3.1], [2.3, 3.6], [0.7, 3.6], [0, 2.9], [0.5, 2.1], [2.5, 1.5], [3, 0.7], [2.3, 0], [0.6, 0], [0, 0.5]]] },
    n: { w: 3, s: [[[0, 0], [0, 3.6]], [[0, 2.5], [1, 3.6], [2.3, 3.6], [3, 2.8], [3, 0]]] },
    o: { w: 3.2, s: [[[1, 0], [2.3, 0], [3.2, 0.9], [3.2, 2.7], [2.3, 3.6], [0.9, 3.6], [0, 2.7], [0, 0.9], [1, 0]]] },
    w: { w: 4, s: [[[0, 3.6], [1, 0], [2, 2.5], [3, 0], [4, 3.6]]] },
    " ": { w: 1.4, s: [] }
  }
  let x = x0
  const by = base - 5.5
  for (const ch of text) {
    const g = glyphs[ch]
    if (!g) continue
    for (const stroke of g.s) {
      const pts = stroke.map(([u, v]) => [x + u * k, by - v * k])
      S.writeStart(w, pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) S.writeTo(w, pts[i][0], pts[i][1])
      S.writeEnd(w)
    }
    x += (g.w + 1.3) * k
  }
}

function CATPPUCCIN() {
  const p = path.join(__dirname, "..", "..", "omarchy", "themes", "catppuccin", "colors.toml")
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  return 'accent = "#89b4fa"\nbackground = "#1e1e2e"\nforeground = "#cdd6f4"\nred = "#f38ba8"\nyellow = "#f9e2af"\ngreen = "#a6e3a1"\ncyan = "#94e2d5"\nblue = "#89b4fa"\nmagenta = "#f5c2e7"\n'
}
