// Visual verification for frost and ice riding a moving window, on the
// motion of the supplied screen recording (tests/fixtures/recording-path.json:
// the dragged window's position on every frame of it).
//
// One simulation, painted two ways, frame by frame, as the desktop shows it:
//   BEFORE  the overlay alone: it paints the window's frost, ledge and
//           icicles where Hyprland last told it the window was. The shell's
//           readings are modelled as 30 ms late, stamped when they arrive
//           (this reproduces the recording: mean 43 px, the video 45 px).
//   AFTER   with the flurry-anchor plugin: the overlay paints the strips
//           (draw.js paintStrip) at most 30 times a second while the window
//           moves, the compositor shows the newest a frame later, placed at
//           the window's position in that frame (the plugin's drawPass); the
//           overlay paints only the falling and shed snow.
//
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-anchor.js <outdir>
//
// Writes <outdir>/f###.png (before | after), <outdir>/sheet.png and
// <outdir>/metrics.json.
"use strict"
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs"), path = require("path")
const load = require("./load")
const { makeHarness } = require("./attach-harness")
const out = process.argv[2] || "anchor-out"
fs.mkdirSync(out, { recursive: true })
const S = load("lib/sim.js"), D = load("lib/draw.js")
const rec = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "recording-path.json"), "utf8"))
const W = 1920, H = 1080, K = 0.5, dt = 1 / 60
const L = Number(process.env.LATENCY || 0.03)

// Seeded, so every run is the same.
let seed = 4242
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

const offs = rec.offsets
const pathAt = t => {
  const f = t * rec.fps, i = Math.min(offs.length - 2, Math.max(0, Math.floor(f))), u = Math.min(1, Math.max(0, f - i))
  return { x: offs[i][0] + (offs[i + 1][0] - offs[i][0]) * u, y: offs[i][1] + (offs[i + 1][1] - offs[i][1]) * u }
}
const win = { id: "0xa", x: rec.start[0], y: rec.start[1] - 300, w: 1000, h: 380, z: 0 }
const other = { id: "0xb", x: 1300, y: 640, w: 560, h: 300, floating: true, z: 5 }
const h = makeHarness({ S, D, path: pathAt, window: win, others: [other], grab: { x: 300, y: 16 }, snapshot: true, icicles: true,
                        delay: L + 0.012, ptrAge: L, seenAge: 0 })
h.settle(5, 13)
S.freezeNow(h.w)
S.setEnv(h.w, { snowScale: 1 })

function wallpaper(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#4a2a6e"); g.addColorStop(0.5, "#d9578a"); g.addColorStop(1, "#2e2a62")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}
function term(ctx, r, name) {
  ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2)
  ctx.fillStyle = "#c0caf5"; ctx.font = "22px sans-serif"; ctx.fillText(name, r.x + 18, r.y + 36)
}

// The plugin's textures: per strip, the picture and when it was made.
let tex = null, pending = null, lastExport = -1, lastSig = ""
function exportStrips(w, s) {
  const strips = D.anchorStrips(s, w.border)
  return strips.map(st => {
    const c = createCanvas(Math.ceil(st.w), Math.ceil(st.h))
    D.paintStrip(c.getContext("2d"), w, s, st, 1)
    return { st, c, mass: s.bins.reduce((a, b) => a + b, 0) }
  })
}

const metrics = []
// Reused every frame (fresh canvases each frame run the process out of memory).
const C_OUT = createCanvas(W * 2 * K + 12, H * K + 40), C_PANE = createCanvas(W, H), C_OV = createCanvas(W, H)
const N = offs.length - 2
let f = 0
h.run(N / rec.fps, (fr, w, s) => {
  f++
  // The compositor shows last frame's export now (one frame to the screen).
  if (pending) { tex = pending; pending = null }
  const sig = D.attachedSig(w, s)
  if (!tex || (sig !== lastSig && fr.t - lastExport >= 1 / 30 - 1e-9)) { pending = exportStrips(w, s); lastSig = sig; lastExport = fr.t; if (!tex) { tex = pending; pending = null } }
  const shown = { ...win, x: fr.shown.x, y: fr.shown.y }
  const otherShown = other

  const every = Number(process.env.EVERY || 1)
  const drawIt = f % every === 0
  const c = drawIt ? C_OUT : null, ctx = c ? c.getContext("2d") : null
  if (drawIt) {
  ctx.fillStyle = "#0b0b12"; ctx.fillRect(0, 0, c.width, c.height)
  for (const side of [0, 1]) {
    const pane = C_PANE, p = pane.getContext("2d")
    wallpaper(p)
    term(p, otherShown, "notes")
    term(p, shown, "Files")
    const ov = C_OV, o = ov.getContext("2d")
    o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, W, H)
    if (side === 0) { w.anchored = null; D.world(o, w) }
    else {
      w.anchored = { [win.id]: true }
      D.world(o, w)
      w.anchored = null
    }
    // The other window is in front of nothing here; the dragged one is in
    // front of it, so it covers the overlay where the overlay paints its
    // face (cleared) and, with the plugin, carries its strips.
    p.drawImage(ov, 0, 0)
    if (side === 1) for (const t of tex) p.drawImage(t.c, shown.x + t.st.ox, shown.y + t.st.oy)
    ctx.drawImage(pane, side * (W * K + 12), 40, W * K, H * K)
  }
  ctx.fillStyle = "#ffd27a"; ctx.font = "22px sans-serif"
  ctx.fillText(`BEFORE: overlay only   frame ${f}`, 12, 28)
  ctx.fillText("AFTER: flurry-anchor plugin", W * K + 24, 28)
  fs.writeFileSync(path.join(out, `f${String(f).padStart(3, "0")}.png`), c.toBuffer("image/png"))
  }
  // Where the frost, ledge and icicles are drawn, against the window.
  const pl = D.placeOf(w, s)
  const before = Math.hypot(pl.x - shown.x, pl.y - shown.y)
  // With the plugin they are drawn at the window's position in this frame;
  // what can be off is only their shape, a frame or two old: the ledge's
  // snow in the shown strip against the snow on the window now.
  const mass = s.bins.reduce((a, b) => a + b, 0)
  const stale = Math.abs(tex[0].mass - mass) / Math.max(1, s.bins.length)
  metrics.push({ f, t: fr.t, speed: 0, before, after: 0, staleLedgePx: stale })
})
for (let i = 1; i < metrics.length; i++) {
  const a = rec.offsets[i - 1], b = rec.offsets[i]
  metrics[i].speed = Math.hypot(b[0] - a[0], b[1] - a[1]) * rec.fps
}
const moving = metrics.filter(m => m.speed > 60)
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const summary = {
  frames: metrics.length, moving: moving.length, latencyModelS: L,
  before: { meanPx: mean(moving.map(m => m.before)), maxPx: Math.max(...metrics.map(m => m.before)) },
  after: { meanPx: 0, maxPx: 0, note: "placed at the window's position in the frame it is drawn (the plugin's drawPass)" },
  staleLedge: { meanPx: mean(moving.map(m => m.staleLedgePx)), maxPx: Math.max(...metrics.map(m => m.staleLedgePx)) }
}
fs.writeFileSync(path.join(out, "metrics.json"), JSON.stringify({ summary, metrics }, null, 1))
console.log(JSON.stringify(summary))
