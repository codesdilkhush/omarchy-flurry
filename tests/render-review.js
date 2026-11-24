// A before/after contact sheet for the review: the window lifecycle (ledge
// snow and icicles, the same window closed, a frame mid-drag) and every
// character (hare, robin, Santa, the train, gifts, the tree, the snowman).
// The left column is painted by an older copy of lib/ (pass its folder),
// the right one by this tree.
//   NODE_PATH=<dir with @napi-rs/canvas> node tests/render-review.js out.png [old-root]
const { createCanvas } = require("@napi-rs/canvas")
const fs = require("fs"), path = require("path")

const out = process.argv[2] || "review.png"
const oldRoot = process.argv[3] || null

function loadFrom(root, rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8").replace(/^\.pragma library\s*/m, "").replace(/^\.import .*$/mg, "")
  const names = [...src.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/mg)].map(m => m[1])
  return new Function(src + "\nreturn {" + [...new Set(names)].map(n => n + ": " + n).join(", ") + "}")()
}
const here = path.join(__dirname, "..")
const libs = root => ({ S: loadFrom(root, "lib/sim.js"), D: loadFrom(root, "lib/draw.js") })

const PW = 520, PH = 300, dt = 1 / 60

// A dusk wallpaper like the user's: violet to pink, a soft sun.
function wallpaper(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, "#5b2a73"); g.addColorStop(0.55, "#c4457f"); g.addColorStop(1, "#f08aa0")
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  const sun = ctx.createRadialGradient(W * 0.6, H * 0.95, 10, W * 0.6, H * 0.95, H * 0.6)
  sun.addColorStop(0, "rgba(255,214,170,0.75)"); sun.addColorStop(1, "rgba(255,214,170,0)")
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H)
}
function terminal(ctx, r) {
  ctx.fillStyle = "#1b1d2a"; ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeStyle = "#7aa2f7"; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2)
  ctx.fillStyle = "#9ece6a"; ctx.font = "12px monospace"; ctx.fillText("~ ❯", r.x + 12, r.y + 22)
  ctx.fillStyle = "#c0caf5"; ctx.fillRect(r.x + 42, r.y + 11, 7, 14)
}

// The desktop, then the overlay painted on its own transparent layer and
// laid over it, as the compositor does. zoom: { x, y, k } centre and scale.
function frame(D, w, rects, zoom, label) {
  const c = createCanvas(PW, PH), ctx = c.getContext("2d")
  const k = zoom ? zoom.k : PW / w.width
  const cx = zoom ? zoom.x : w.width / 2, cy = zoom ? zoom.y : w.height / 2
  const tx = PW / 2 / k - cx, ty = PH / 2 / k - cy
  ctx.save(); ctx.scale(k, k); ctx.translate(tx, ty)
  wallpaper(ctx, w.width, w.height)
  for (const r of rects.slice().sort((a, b) => (a.floating - b.floating) || (b.z - a.z))) terminal(ctx, r)
  ctx.restore()
  const layer = createCanvas(PW, PH), l = layer.getContext("2d")
  l.scale(k, k); l.translate(tx, ty)
  D.world(l, w)
  ctx.drawImage(layer, 0, 0)
  tag(ctx, label)
  return c
}
function tag(ctx, label) {
  ctx.fillStyle = "rgba(10,10,20,0.55)"; ctx.fillRect(0, 0, PW, 24)
  ctx.fillStyle = "#fff"; ctx.font = "13px sans-serif"; ctx.fillText(label, 8, 16)
}
// A character on its own: painted in its box over a slice of wallpaper and
// a snowbank, with the box's feet on the snow.
function still(label, w, h, scale, paint) {
  const c = createCanvas(PW, PH), ctx = c.getContext("2d")
  wallpaper(ctx, PW, PH * 2.2)
  const ground = PH - 34
  ctx.fillStyle = "#eef3fb"
  ctx.beginPath(); ctx.moveTo(0, ground + 4)
  for (let x = 0; x <= PW; x += 20) ctx.quadraticCurveTo(x + 10, ground + 2 + Math.sin(x * 0.05) * 2, x + 20, ground + 4)
  ctx.lineTo(PW, PH); ctx.lineTo(0, PH); ctx.closePath(); ctx.fill()
  // Each character paints into its own transparent canvas in the shell
  // (and clears it first), so here too.
  const layer = createCanvas(PW, PH), l = layer.getContext("2d")
  paint(l, ground, scale)
  ctx.drawImage(layer, 0, 0)
  tag(ctx, label)
  return c
}

// ------------------------------------------------------------- scenes

const W = 1920, H = 1080
const term = { id: "0x55d1c0a3e2f0", x: 560, y: 380, w: 900, h: 460, floating: true, z: 0 }

function snowyTerminal(L, secs) {
  const w = L.S.createWorld(W, H, { effect: "snow", intensity: 1.4, plow: false })
  L.S.setEnv(w, { tempC: -4, icicle: 1 })
  for (let t = 0; t < secs; t += dt) { L.S.setSurfaces(w, [term], w.time); L.S.step(w, dt) }
  return w
}

function lifecycle(L, old) {
  const panels = []
  const w = snowyTerminal(L, 150)
  const zoomTop = { x: 1010, y: 600, k: 0.5 }
  panels.push(frame(L.D, w, [term], zoomTop, (old ? "before" : "after") + ": ledge snow and icicles after 2.5 min"))
  panels.push(frame(L.D, w, [term], { x: term.x + 90, y: term.y + 20, k: 2.2 }, (old ? "before" : "after") + ": the ledge's corner, close up"))
  panels.push(frame(L.D, w, [term], { x: term.x + 200, y: term.y + term.h + 10, k: 2.2 }, (old ? "before" : "after") + ": icicles on the bottom edge, close up"))
  // Closed. The old shell kept a stale toplevel and fed its rectangle on.
  const w2 = snowyTerminal(L, 150)
  for (let t = 0; t < 2.5; t += dt) { L.S.setSurfaces(w2, old ? [term] : [], w2.time, []); L.S.step(w2, dt) }
  panels.push(frame(L.D, w2, [], zoomTop, (old ? "before: window closed (stale toplevel: ghost ledge)" : "after: 2.5 s after closing - no ghost")))
  // A drag: the first sample comes after the idle poll, then every frame.
  const w3 = snowyTerminal(L, 150)
  let x = term.x, y = term.y, shot = null
  for (let t = 0; t < 1.0; t += dt) {
    const poll = t < 0.22 ? null : { x: term.x + (t - 0.22) * 900, y: term.y + Math.sin((t - 0.22) * 6) * 60 }
    if (poll) { x = poll.x; y = poll.y }
    L.S.setSurfaces(w3, [Object.assign({}, term, { x, y })], w3.time)
    L.S.step(w3, dt)
    if (t > 0.62 && !shot) shot = 1
    if (shot === 1) { shot = frame(L.D, w3, [Object.assign({}, term, { x, y })], { x: x + 450, y: y + 60, k: 0.6 }, (old ? "before" : "after") + ": mid-drag at ~900 px/s") }
  }
  panels.push(shot)
  return panels
}

function characters(L, old) {
  const D = L.D, P = []
  const who = old ? "before" : "after"
  // The hare: mid-hop and sat up (the cat it replaced is gone).
  if (D.drawRabbit) P.push(still(who + ": the hare, hopping and sat up", 0, 0, 3.2, (ctx, gy, k) => {
    ctx.save(); ctx.translate(140, gy); ctx.scale(k, k)
    D.drawRabbit(ctx, { x: 0, y: -5, dir: 1, pose: 1, up: 0, ears: 0.4, lift: 5, nose: 0, coat: "white" })
    ctx.restore()
    ctx.save(); ctx.translate(370, gy); ctx.scale(k, k)
    D.drawRabbit(ctx, { x: 0, y: 0, dir: -1, pose: 0, up: 1, ears: 1, lift: 0, nose: 0.6, look: 0.3, coat: "white" })
    ctx.restore()
  }))
  P.push(still(who + ": the robin, perched, pecking, flying", 0, 0, 4, (ctx, gy, k) => {
    const birds = [
      { x: 0, y: 0, facing: 1, mode: "perch", peck: 0, flap: 0, look: 0.3 },
      { x: 0, y: 0, facing: -1, mode: "perch", peck: 0.9, flap: 0, look: 0 },
      { x: 0, y: -16, facing: 1, mode: "out", peck: 0, flap: 0.05, t: 1 }
    ]
    birds.forEach((b, i) => { ctx.save(); ctx.translate(100 + i * 150, gy); ctx.scale(k, k); D.drawBird(ctx, b, 1); ctx.restore() })
  }))
  P.push(still(who + ": Santa", 0, 0, 1.8, (ctx, gy, k) => {
    ctx.save(); ctx.translate(26, 46); ctx.scale(k, k); D.sleigh(ctx, 260, 96, 0.8); ctx.restore()
  }))
  P.push(still(who + ": the little train", 0, 0, 2.2, (ctx, gy, k) => {
    ctx.save(); ctx.translate(40, gy - 80 * k + 6); ctx.scale(k, k); D.train(ctx, 200, 80, 0.6, 1, "gift"); ctx.restore()
  }))
  P.push(still(who + ": gifts", 0, 0, 2.6, (ctx, gy, k) => {
    const colors = ["#c0392b", "#2e86de", "#27ae60"]
    colors.forEach((c, i) => { ctx.save(); ctx.translate(90 + i * 130, gy - 44 * k + 4); ctx.scale(k, k); D.gift(ctx, 44, 44, c); ctx.restore() })
  }))
  P.push(still(who + ": the tree", 0, 0, 1.2, (ctx, gy, k) => {
    const opts = { growth: 1, star: true, seed: "review", ornaments: [
      { kind: "bauble", u: -0.4, v: 0.55, color: "#e74c3c" }, { kind: "bauble", u: 0.35, v: 0.7, color: "#3498db" },
      { kind: "bauble", u: 0.1, v: 0.35, color: "#f1c40f" }, { kind: "light", u: -0.2, v: 0.45, color: "#ffd84d" },
      { kind: "light", u: 0.3, v: 0.5, color: "#ff6b6b" }, { kind: "candy", u: -0.15, v: 0.8, color: "#e74c3c" },
      { kind: "light", u: 0.05, v: 0.62, color: "#7ee8fa" }, { kind: "bauble", u: -0.55, v: 0.85, color: "#9b59b6" }] }
    ctx.save(); ctx.translate(PW / 2 - 75 * k, gy - 215 * k + 6); ctx.scale(k, k)
    D.tree(ctx, 150, 215, opts, 0); D.treeLights(ctx, 150, 215, opts, 2.2)
    ctx.restore()
  }))
  P.push(still(who + ": the snowman", 0, 0, 1.9, (ctx, gy, k) => {
    ctx.save(); ctx.translate(PW / 2 - 37 * k, gy - 128 * k + 6); ctx.scale(k, k)
    D.snowman(ctx, 74, 128, { built: 1, scarf: "#c0392b", outfit: { nose: true, scarf: true, hat: true } })
    ctx.restore()
  }))
  return P
}

const after = libs(here)
const before = oldRoot ? libs(oldRoot) : null
const rowsAfter = lifecycle(after, false).concat(characters(after, false))
const rowsBefore = before ? lifecycle(before, true).concat(characters(before, true)) : []
const cols = before ? 2 : 1
const sheet = createCanvas(PW * cols + (cols - 1) * 6, rowsAfter.length * (PH + 6) - 6)
const sctx = sheet.getContext("2d")
sctx.fillStyle = "#0b0b12"; sctx.fillRect(0, 0, sheet.width, sheet.height)
rowsAfter.forEach((p, i) => {
  if (before) sctx.drawImage(rowsBefore[i], 0, i * (PH + 6))
  sctx.drawImage(p, before ? PW + 6 : 0, i * (PH + 6))
})
fs.writeFileSync(out, sheet.toBuffer("image/png"))
console.log("wrote", out, sheet.width + "x" + sheet.height)
