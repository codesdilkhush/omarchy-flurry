// Renders a decorated tree (both layers, at 2x) and a window wearing a light
// string: at rest, mid-swing after a drag, and settled.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-lights.js tree.png window.png
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load("lib/sim.js")
const D = load("lib/draw.js")
const St = load("lib/store.js")
const [treeOut = "tree.png", winOut = "window-lights.png"] = process.argv.slice(2)

// ---- tree
{
  const Z = 3, W = 150, H = 215, pad = 40
  const c = createCanvas((W + pad * 2) * Z * 2, (H + pad) * Z), ctx = c.getContext("2d")
  const g = ctx.createLinearGradient(0, 0, 0, c.height)
  g.addColorStop(0, "#141b2b"); g.addColorStop(1, "#27324c")
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height)
  const orn = []
  const lightSpots = [[-0.2, 0.08], [0.25, 0.18], [-0.45, 0.3], [0.1, 0.36], [0.55, 0.44], [-0.15, 0.52], [-0.7, 0.62], [0.3, 0.66], [0.75, 0.76], [-0.35, 0.82], [0.05, 0.92], [-0.8, 0.96]]
  lightSpots.forEach(([u, v], i) => orn.push({ kind: "light", u, v, color: St.LIGHT_COLORS[i % St.LIGHT_COLORS.length] }))
  ;[[0.3, 0.05], [-0.5, 0.2], [0.6, 0.3], [-0.05, 0.42], [-0.6, 0.48], [0.45, 0.58], [-0.3, 0.7], [0.05, 0.78], [0.6, 0.9], [-0.6, 0.9]]
    .forEach(([u, v], i) => orn.push({ kind: "bauble", u, v, color: St.BAUBLE_COLORS[i % St.BAUBLE_COLORS.length] }))
  orn.push({ kind: "candy", u: -0.75, v: 0.4 }, { kind: "candy", u: 0.8, v: 0.62 })
  const t = { growth: 1, star: true, ornaments: orn, seed: "demo" }
  ;[0, 1.7].forEach((time, k) => {
    for (const [fn, layer] of [[D.tree, 0], [D.treeLights, 1]]) {
      const l = createCanvas((W + pad * 2) * Z, (H + pad) * Z), lc = l.getContext("2d")
      lc.scale(Z, Z); lc.translate(pad, pad)
      fn(lc, W, H, t, time)
      ctx.drawImage(l, k * (W + pad * 2) * Z, 0)
    }
  })
  fs.writeFileSync(treeOut, c.toBuffer("image/png"))
}

// ---- window lights
{
  const W = 900, H = 420, dt = 1 / 60
  const w = S.createWorld(W, H, { effect: "snow", intensity: 1, plow: false })
  const win = { id: "term", x: 150, y: 120, w: 600, h: 260, floating: true, z: 0 }
  S.setSurfaces(w, [win], 0)
  w.surfaces.term.bins.fill(4)
  w.surfaces.term.pack = 0.9
  const spec = [{ id: "s1", surface: "term", palette: "multi" }]
  const run = (secs, offset) => {
    for (let t = 0; t < secs; t += dt) {
      const r = Object.assign({}, win, { x: win.x + (offset ? offset(t) : 0) })
      S.setSurfaces(w, [r], w.time); S.setStrings(w, spec); S.step(w, dt)
      win._x = r.x
    }
  }
  const paint = (label) => {
    const c = createCanvas(W, H), ctx = c.getContext("2d")
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, "#151c2c"); g.addColorStop(1, "#2a3550")
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const s = w.surfaces.term
    ctx.fillStyle = "#0e1118"; ctx.fillRect(s.x, s.y, s.w, s.h)
    ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(s.x, s.y, s.w, s.h)
    ctx.fillStyle = "#9ece6a"; ctx.font = "15px monospace"
    ;["~ $ flurry lights", "lights on kitty", "~ $ █"].forEach((l, i) => ctx.fillText(l, s.x + 16, s.y + 70 + i * 22))
    const layer = createCanvas(W, H)
    D.world(layer.getContext("2d"), w)
    ctx.drawImage(layer, 0, 0)
    ctx.fillStyle = "#fff"; ctx.font = "15px sans-serif"; ctx.fillText(label, 12, 22)
    return c
  }
  run(4)
  const frames = [paint("at rest")]
  // Drag right 220 px in 0.25 s, then stop.
  const off = t => Math.min(220, 220 * t / 0.25)
  run(0.35, off)
  win.x += 220
  frames.push(paint("just after a quick drag to the right"))
  run(0.25)
  frames.push(paint("swinging back"))
  run(4)
  frames.push(paint("settled"))
  const strip = createCanvas(W, H * frames.length), sc = strip.getContext("2d")
  frames.forEach((f, i) => sc.drawImage(f, 0, H * i))
  fs.writeFileSync(winOut, strip.toBuffer("image/png"))
}
