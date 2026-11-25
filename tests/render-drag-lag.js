// The "line" bug, as a frame strip. Hyprland moves a dragged window at once,
// but the shell only learns its new rectangle a poll or two later, so the
// overlay paints its snow at a stale rectangle. Each panel draws the window
// where the compositor shows it (ahead) and the overlay from the world fed
// the lagging samples, exactly as on a real desktop.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-drag-lag.js out.png [lib/sim.js] [label] [lib/draw.js]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs")
const load = require("./load")
const S = load(process.argv[3] || "lib/sim.js")
const D = load(process.argv[5] || "lib/draw.js")
const out = process.argv[2] || "drag-lag.png"
const title = process.argv[4] || ""

const W = 1920, H = 1080, dt = 1 / 60
const LAG = 3                 // frames the shell's rectangle trails the compositor (~50 ms)
const K = 0.42, PW = W * K, PH = H * K
const term = { id: "0xterm", x: 420, y: 420, w: 900, h: 460, floating: true, z: 0 }

function wallpaper(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#5b2a6e"); g.addColorStop(0.55, "#d9578a"); g.addColorStop(1, "#3a2a6e")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}
function terminal(ctx, r) {
  ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 3; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2)
  ctx.fillStyle = "#9ece6a"; ctx.font = "26px monospace"; ctx.fillText("~ ❯ ", r.x + 18, r.y + 40)
}
function shot(w, shown, label) {
  const c = createCanvas(PW, PH), ctx = c.getContext("2d")
  ctx.save(); ctx.scale(K, K); wallpaper(ctx); terminal(ctx, shown); ctx.restore()
  // The overlay sits above the windows (as in the shell), from the world's lagging view.
  const layer = createCanvas(PW, PH), l = layer.getContext("2d")
  l.scale(K, K); D.world(l, w)
  ctx.drawImage(layer, 0, 0)
  ctx.fillStyle = "rgba(10,10,20,0.7)"; ctx.fillRect(0, PH - 30, PW, 30)
  ctx.fillStyle = "#fff"; ctx.font = "17px sans-serif"; ctx.fillText(label, 10, PH - 9)
  return c
}

const w = S.createWorld(W, H, { effect: "snow", intensity: 1.3, plow: false })
// The pointer holds the title bar; the shell reads it every frame (a frame
// old) and the windows a poll late, LAG frames behind the compositor.
const grab = { x: 400, y: 14 }
const pointerOn = (r, vx, vy, still) => ({ x: r.x + grab.x, y: r.y + grab.y, vx, vy, present: true, stillFor: still, age: dt })
const hint = (ptr) => ({ pointer: ptr, poll: ptr.stillFor > 0.2 ? 0.2 : 0.016, layoutAge: 30 })
const rest = pointerOn(term, 0, 0, 2)
for (let t = 0; t < 120; t += dt) { S.setSurfaces(w, [term], w.time, [term.id], hint(rest)); S.step(w, dt, { pointer: rest }) }
S.setEnv(w, { snowScale: 0 }); w.particles = []
for (let t = 0; t < 2; t += dt) { S.setSurfaces(w, [term], w.time, [term.id], hint(rest)); S.step(w, dt, { pointer: rest }) }

// A hand drag: up-left, then down-right, like in the video, then a stop.
const PATHS = {
  // A sudden pull straight up, then a stop.
  up: t => t < 0.18 ? { x: 0, y: -1800 * t } : { x: 0, y: -324 },
  // As in the user's recording: a pull down, a hold, a yank up, then a quick up-and-down shake.
  jerk: t => {
    const e = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)
    if (t < 0.3) return { x: 0, y: 0 }
    if (t < 0.8) return { x: 0, y: 220 * e((t - 0.3) / 0.5) }
    if (t < 1.0) return { x: 0, y: 220 }
    if (t < 1.2) return { x: 0, y: 220 - 300 * e((t - 1.0) / 0.2) }
    if (t < 2.2) return { x: 0, y: -80 + 110 * Math.sin((t - 1.2) * 2 * Math.PI * 2.5) * Math.min(1, (t - 1.2) * 6) }
    return { x: 0, y: -80 }
  },
}
const path = PATHS[process.env.PATH_KIND] || (t => t < 0.5 ? { x: -700 * t, y: -260 * t } : t < 1.25 ? { x: -350 + 900 * (t - 0.5), y: -130 + 420 * (t - 0.5) } : { x: 325, y: 185 })
const frames = [shot(w, term, title + " · at rest")]
const hist = []
const keep = process.env.PATH_KIND === "up" ? { 2: "+33 ms", 4: "+67 ms", 6: "+0.1 s", 9: "+0.15 s", 12: "+0.2 s", 16: "+0.27 s", 24: "+0.4 s" } : { 6: "drag +0.1 s", 15: "drag +0.25 s", 27: "drag +0.45 s", 40: "reversed +0.67 s", 55: "+0.92 s", 75: "+1.25 s" }
const LAST = process.env.FRAMES ? (process.env.PATH_KIND === "jerk" ? 160 : 150) : 75
for (let f = 0; f <= LAST; f++) {
  const p = path(f * dt)
  // What the compositor shows when this frame of snow reaches the screen, a
  // frame on (only for the jerk path; the others keep their old framing).
  const pa = process.env.PATH_KIND === "jerk" ? path((f + 1) * dt) : p
  const shown = Object.assign({}, term, { x: term.x + p.x, y: term.y + p.y })
  const onScreen = Object.assign({}, term, { x: term.x + pa.x, y: term.y + pa.y })
  hist.push(shown)
  const seen = hist[Math.max(0, hist.length - 1 - LAG)]
  const c0 = hist[Math.max(0, hist.length - 2)], c1 = hist[Math.max(0, hist.length - 3)]
  const ptr = pointerOn(c0, (c0.x - c1.x) / dt, (c0.y - c1.y) / dt, c0.x === c1.x && c0.y === c1.y ? 1 : 0)
  S.setSurfaces(w, [seen], w.time, [term.id], hint(ptr))
  S.step(w, dt, { pointer: ptr })
  if (keep[f]) frames.push(shot(w, shown, title + " · " + keep[f]))
  if (process.env.FRAMES) fs.writeFileSync(process.env.FRAMES + "/f" + String(f).padStart(3, "0") + ".png", shot(w, onScreen, title).toBuffer("image/png"))
}
const cols = 4, rows = Math.ceil(frames.length / cols)
const sheet = createCanvas(PW * cols + 6 * (cols - 1), PH * rows + 6 * (rows - 1)), sc = sheet.getContext("2d")
sc.fillStyle = "#0b0b12"; sc.fillRect(0, 0, sheet.width, sheet.height)
frames.forEach((fr, i) => sc.drawImage(fr, (i % cols) * (PW + 6), Math.floor(i / cols) * (PH + 6)))
fs.writeFileSync(out, sheet.toBuffer("image/png"))
console.log("wrote", out)
