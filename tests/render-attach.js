// Visual regression for the window-attachment bug (snow strips left behind
// a shaken window, lines across its face, flakes painted over app content).
// Replays a hand shaking a window up and down, side to side and
// diagonally, across a second window, through the attach harness (the
// compositor moves the window with the pointer; the shell reads it late),
// and paints every frame as the desktop shows it: the windows where the
// compositor has them, the overlay on top.
//
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-attach.js <outdir> [simPath] [drawPath] [label]
//
// Writes <outdir>/f###.png (every frame), <outdir>/sheet.png (a strip of
// picked frames) and <outdir>/metrics.json: per frame, how far the painted
// snow is from the window, and how many overlay pixels land inside either
// window's content (below its top edge, above its bottom edge).
"use strict"
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs"), path = require("path")
const load = require("./load")
const { makeHarness, shakePath, jitteryDelay } = require("./attach-harness")
const out = process.argv[2] || "attach-out"
const S = load(process.argv[3] || "lib/sim.js"), D = load(process.argv[4] || "lib/draw.js")
const label = process.argv[5] || ""
fs.mkdirSync(out, { recursive: true })

const W = 1920, H = 1080, K = 0.5
const back = { id: "0xb", x: 1050, y: 560, w: 760, h: 380, floating: true, z: 5 }
// Up and down, side to side, diagonal, then a long drag across the other
// window, with the short holds a hand makes at each turn; then let go.
const ease = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)
const seg = [
  [0.2, shakePath({ start: 0, strokes: 6, amp: 160, ax: 0, ay: 1, stroke: 0.1, hold: 0.06 })],
  [1.3, shakePath({ start: 0, strokes: 6, amp: 260, ax: 1, ay: 0, stroke: 0.11, hold: 0.05 })],
  [2.3, shakePath({ start: 0, strokes: 6, amp: 220, ax: 0.8, ay: -0.6, stroke: 0.1, hold: 0.07 })],
  [3.4, t => ({ x: 640 * ease(t / 0.6), y: 330 * ease(t / 0.6) })],
  [4.4, t => ({ x: 640 - 640 * ease(t / 0.5), y: 330 - 330 * ease(t / 0.5) })],
]
const route = t => {
  let off = { x: 0, y: 0 }
  for (let i = 0; i < seg.length; i++) {
    const [t0, f] = seg[i], t1 = i + 1 < seg.length ? seg[i + 1][0] : 1e9
    if (t < t0) break
    const p = f(Math.min(t, t1) - t0)
    off = i === 3 || i === 4 ? p : { x: p.x, y: p.y }
  }
  return off
}
const h = makeHarness({ S, D, path: route, window: { id: "0xa", x: 300, y: 260, w: 840, h: 420, z: 0 }, others: [back],
                        grab: { x: 380, y: 16 }, snapshot: !!S.noteStill, icicles: true, delay: jitteryDelay(7, 0.02, 0.14) })
h.settle(4, 5)
S.setEnv(h.w, { snowScale: 1 })

function wallpaper(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#4a2a6e"); g.addColorStop(0.5, "#d9578a"); g.addColorStop(1, "#2e2a62")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}
function term(ctx, r, name) {
  ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2)
  ctx.fillStyle = "#9ece6a"; ctx.font = "22px monospace"; ctx.fillText("~ ❯ " + name, r.x + 16, r.y + 34)
}
const metrics = []
const picks = { 30: "shake up/down", 52: "shake up/down", 95: "side to side", 120: "side to side", 160: "diagonal", 190: "diagonal",
                230: "across the other window", 250: "across", 290: "back", 330: "let go, settled" }
const sheetFrames = []
let fi = 0
// Canvases reused frame to frame (a fresh pair a frame runs out of memory).
const layer = createCanvas(W, H), l = layer.getContext("2d")
const small = createCanvas(W * K, H * K), sc = small.getContext("2d")
// The window in front's icicles hang below it, over the one behind: that
// is where they belong, so that band is not counted against the back window.
const ICICLE_REACH = 40
const inside = (img, r, skip) => {
  let n = 0
  for (let y = Math.max(0, Math.ceil(r.y + 3)); y < Math.min(H, r.y + r.h - 2); y++)
    for (let x = Math.max(0, Math.ceil(r.x + 2)); x < Math.min(W, r.x + r.w - 2); x++) {
      if (skip && x >= skip.x - 2 && x < skip.x + skip.w + 2 && y >= skip.y - 3 && y < skip.y + skip.h + ICICLE_REACH) continue
      if (img[(y * W + x) * 4 + 3] > 40) n++
    }
  return n
}
h.run(+(process.env.SECONDS_RUN || 5.6), (fr, w, s) => {
  const A = fr.shown
  l.setTransform(1, 0, 0, 1, 0, 0)
  D.world(l, w)
  // Overlay pixels painted inside the windows' content (2 px in from each
  // edge, so a cap's contact shadow on the very edge is not counted).
  const img = l.getImageData(0, 0, W, H).data
  const m = { f: fi, t: +fr.t.toFixed(3), ex: +fr.ex.toFixed(1), ey: +fr.ey.toFixed(1), inA: inside(img, A), inB: inside(img, back, A) }
  metrics.push(m)
  if (process.env.WHERE && m.inA + m.inB > 0) { const xs = []; for (let y = Math.ceil(A.y + 3); y < A.y + A.h - 2; y++) for (let x = Math.ceil(A.x + 2); x < A.x + A.w - 2; x++) if (img[(y * W + x) * 4 + 3] > 40) xs.push([x - A.x, y - A.y]); if (xs.length) console.error('f' + fi, 'A-local px', JSON.stringify(xs.slice(0, 6)), xs.length); const ys = []; for (let y = Math.ceil(back.y + 3); y < back.y + back.h - 2; y++) for (let x = Math.ceil(back.x + 2); x < back.x + back.w - 2; x++) if (img[(y * W + x) * 4 + 3] > 40 && !(x >= A.x - 2 && x < A.x + A.w + 2 && y >= A.y - 3 && y < A.y + A.h + 2)) ys.push([x - back.x, y - back.y]); if (ys.length) console.error('f' + fi, 'B-local px', JSON.stringify(ys.slice(0, 8)), ys.length) }
  sc.setTransform(K, 0, 0, K, 0, 0)
  wallpaper(sc); term(sc, back, "back"); term(sc, A, "dragged")
  sc.drawImage(layer, 0, 0)
  sc.setTransform(1, 0, 0, 1, 0, 0)
  sc.fillStyle = "rgba(10,10,20,0.7)"; sc.fillRect(0, H * K - 28, W * K, 28)
  sc.fillStyle = "#fff"; sc.font = "16px sans-serif"
  sc.fillText(`${label} t=${fr.t.toFixed(2)}s  snow off window by ${Math.hypot(fr.ex, fr.ey).toFixed(0)}px  overlay px inside windows: ${m.inA + m.inB}`, 8, H * K - 9)
  if (picks[fi]) { sc.fillStyle = "#ffd27a"; sc.fillText(picks[fi], 8, 22) }
  const png = small.toBuffer("image/png")
  fs.writeFileSync(path.join(out, "f" + String(fi).padStart(3, "0") + ".png"), png)
  if (picks[fi]) sheetFrames.push(png)
  fi++
})
const { loadImage } = require("@napi-rs/canvas")
;(async () => {
const cols = 2, rows = Math.ceil(sheetFrames.length / cols)
const sheet = createCanvas(W * K * cols + 6, H * K * rows + 6 * (rows - 1)), ss = sheet.getContext("2d")
ss.fillStyle = "#0b0b12"; ss.fillRect(0, 0, sheet.width, sheet.height)
for (let i = 0; i < sheetFrames.length; i++) ss.drawImage(await loadImage(sheetFrames[i]), (i % cols) * (W * K + 6), Math.floor(i / cols) * (H * K + 6))
fs.writeFileSync(path.join(out, "sheet.png"), sheet.toBuffer("image/png"))
const drag = metrics.filter(m => m.t > 0.25 && m.t < 5.0)
const summary = {
  frames: metrics.length,
  meanOffset: +(drag.reduce((a, m) => a + Math.hypot(m.ex, m.ey), 0) / drag.length).toFixed(2),
  worstOffset: +Math.max(...drag.map(m => Math.hypot(m.ex, m.ey))).toFixed(2),
  worstSunk: +Math.max(...drag.map(m => m.ey)).toFixed(2),
  framesWithPixelsInContent: metrics.filter(m => m.inA + m.inB > 0).length,
  worstPixelsInContent: Math.max(...metrics.map(m => m.inA + m.inB)),
}
fs.writeFileSync(path.join(out, "metrics.json"), JSON.stringify({ summary, metrics }, null, 1))
console.log(JSON.stringify(summary))
})()
