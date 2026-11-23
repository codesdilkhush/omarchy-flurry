.pragma library

// Drawing for Flurry. Everything is painted procedurally on a QML Canvas
// 2D context, so the plugin ships no image assets. Particles are drawn in
// batches (one path per kind and shade) to keep the per-frame cost flat.

var LEAF_COLORS = ["#d9822b", "#c2452d", "#e3b23c", "#8c5a2b"]
var PETAL_COLORS = ["#f7c6d9", "#f4a7c3", "#fde2ec"]
var SPARK_COLORS = ["#fff4c2", "#ffd27a", "#ff9e5e"]

function world(ctx, w, opts) {
  opts = opts || {}
  ctx.clearRect(0, 0, w.width, w.height)
  drawHeaps(ctx, w)
  drawParticles(ctx, w)
  if (w.bolt) drawBolt(ctx, w.bolt)
  if (w.flash > 0.01) {
    ctx.globalAlpha = Math.min(0.35, w.flash * 0.35)
    ctx.fillStyle = "#e8f0ff"
    ctx.fillRect(0, 0, w.width, w.height)
    ctx.globalAlpha = 1
  }
}

// Snow caps. Surfaces are painted back to front; before each window's cap,
// the window's own face is cleared, so snow lying on a window behind it
// disappears where this window covers it (it is still there, just hidden)
// and shows again when the window moves away. The ground is painted last,
// in front of everything, like a snowbank along the bottom of the screen.
function drawHeaps(ctx, w) {
  var ground = null
  for (var i = w.order.length - 1; i >= 0; i--) {
    var s = w.order[i]
    if (s.ground) { ground = s; continue }
    ctx.clearRect(s.x, s.y, s.w, s.h)
    drawCap(ctx, s)
  }
  if (ground) drawCap(ctx, ground)
}

function drawCap(ctx, s) {
  var b = s.bins
  var n = b.length
  var top = 0
  for (var k = 0; k < n; k++) if (b[k] > top) top = b[k]
  var hangL = s.edges ? s.edges[0].m : 0
  var hangR = s.edges ? s.edges[1].m : 0
  if (top < 0.15 && hangL < 0.1 && hangR < 0.1) return
  var cell = s.w / n
  // A cornice: the edge of the cap curls a little past the window's edge,
  // further while snow is about to pour over it.
  var lipL = s.ground ? 0 : Math.min(4, b[0] * 0.3 + Math.sqrt(hangL) * 2)
  var lipR = s.ground ? 0 : Math.min(4, b[n - 1] * 0.3 + Math.sqrt(hangR) * 2)
  ctx.beginPath()
  ctx.moveTo(s.x, s.y + 1)
  ctx.quadraticCurveTo(s.x - lipL, s.y + 1, s.x - lipL * 0.7, s.y - b[0] * 0.55)
  ctx.quadraticCurveTo(s.x - lipL * 0.2, s.y - b[0], s.x + cell * 0.5, s.y - b[0])
  for (var j = 0; j + 1 < n; j++) {
    var x = s.x + (j + 0.5) * cell
    var nx = s.x + (j + 1) * cell
    ctx.quadraticCurveTo(x, s.y - b[j], nx, s.y - (b[j] + b[j + 1]) / 2)
  }
  var ex = s.x + s.w
  ctx.quadraticCurveTo(ex - cell * 0.5, s.y - b[n - 1], ex + lipR * 0.2, s.y - b[n - 1])
  ctx.quadraticCurveTo(ex + lipR, s.y - b[n - 1] * 0.55, ex + lipR * 0.7, s.y + 1)
  ctx.lineTo(s.x, s.y + 1)
  ctx.closePath()
  var g = ctx.createLinearGradient(0, s.y - top, 0, s.y + 1)
  // Settled snow is a touch greyer and bluer than fresh powder.
  var pack = s.pack === undefined ? 0.5 : s.pack
  g.addColorStop(0, "rgba(255,255,255,0.97)")
  g.addColorStop(1, pack > 0.6 ? "rgba(214,226,242,0.96)" : "rgba(228,236,248,0.96)")
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = "rgba(170,195,230,0.5)"
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawParticles(ctx, w) {
  var ps = w.particles
  var flakesNear = [], flakesFar = [], clumps = [], drops = [], splashes = [], ripples = []
  var dustThick = [], dustThin = []
  var meteors = [], sparks = [], leaves = [], petals = [], flies = []
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i]
    switch (p.kind) {
    case "flake": (p.depth > 0.55 ? flakesNear : flakesFar).push(p); break
    case "clump": clumps.push(p); break
    case "powder": (p.age / p.life < 0.55 ? dustThick : dustThin).push(p); break
    case "drop": drops.push(p); break
    case "splash": splashes.push(p); break
    case "ripple": ripples.push(p); break
    case "meteor": meteors.push(p); break
    case "spark": sparks.push(p); break
    case "leaf": leaves.push(p); break
    case "petal": petals.push(p); break
    case "firefly": flies.push(p); break
    }
  }
  dots(ctx, flakesFar, "rgba(255,255,255,0.55)")
  dots(ctx, flakesNear, "rgba(255,255,255,0.92)")
  dots(ctx, dustThin, "rgba(255,255,255,0.35)")
  dots(ctx, dustThick, "rgba(255,255,255,0.7)")
  drawChunks(ctx, clumps)

  if (drops.length) {
    ctx.beginPath()
    for (var d = 0; d < drops.length; d++) {
      var q = drops[d]
      var len = q.len / Math.hypot(q.vx, q.vy)
      ctx.moveTo(q.x, q.y)
      ctx.lineTo(q.x - q.vx * len, q.y - q.vy * len)
    }
    ctx.strokeStyle = "rgba(190,210,240,0.55)"
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  dots(ctx, splashes, "rgba(200,220,250,0.8)")
  if (ripples.length) {
    ctx.strokeStyle = "rgba(200,220,250,0.5)"
    ctx.lineWidth = 1
    for (var r = 0; r < ripples.length; r++) {
      var rp = ripples[r]
      var t = rp.age / rp.life
      ctx.globalAlpha = 1 - t
      ctx.beginPath()
      ellipse(ctx, rp.x, rp.y, rp.w * (0.4 + t), 1.5 + t * 1.5)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  for (var m = 0; m < meteors.length; m++) drawMeteor(ctx, meteors[m])
  for (var c = 0; c < SPARK_COLORS.length; c++) {
    var group = []
    for (var s = 0; s < sparks.length; s++) if (sparks[s].hue === c) group.push(sparks[s])
    if (!group.length) continue
    ctx.beginPath()
    for (var g = 0; g < group.length; g++) {
      var sp = group[g]
      var rr = sp.r * (1 - sp.age / sp.life)
      ctx.moveTo(sp.x + rr, sp.y)
      ctx.arc(sp.x, sp.y, Math.max(0.3, rr), 0, Math.PI * 2)
    }
    ctx.fillStyle = SPARK_COLORS[c]
    ctx.fill()
  }

  for (var l = 0; l < leaves.length; l++) drawLeaf(ctx, leaves[l])
  for (var pe = 0; pe < petals.length; pe++) drawPetal(ctx, petals[pe])
  for (var f = 0; f < flies.length; f++) drawFirefly(ctx, flies[f])
}

function dots(ctx, list, color) {
  if (!list.length) return
  ctx.beginPath()
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    ctx.moveTo(p.x + p.r, p.y)
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
  }
  ctx.fillStyle = color
  ctx.fill()
}

// Falling chunks of snow: a main lump with a smaller one stuck to it, turned
// by the chunk's spin so they tumble, and a faint blue shade underneath.
function drawChunks(ctx, list) {
  if (!list.length) return
  ctx.beginPath()
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    ctx.moveTo(p.x + p.r, p.y + 0.6)
    ctx.arc(p.x, p.y + 0.6, p.r, 0, Math.PI * 2)
  }
  ctx.fillStyle = "rgba(196,212,236,0.9)"
  ctx.fill()
  ctx.beginPath()
  for (var j = 0; j < list.length; j++) {
    var q = list[j]
    var t = q.angle || 0
    var r2 = q.r * 0.62
    var ox = Math.cos(t) * q.r * 0.55, oy = Math.sin(t) * q.r * 0.55
    ctx.moveTo(q.x + q.r, q.y)
    ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2)
    if (q.r > 1.6) {
      ctx.moveTo(q.x + ox + r2, q.y + oy)
      ctx.arc(q.x + ox, q.y + oy, r2, 0, Math.PI * 2)
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.97)"
  ctx.fill()
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, ry / rx)
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.restore()
}

function drawMeteor(ctx, p) {
  var sp = Math.hypot(p.vx, p.vy)
  var tx = p.x - p.vx / sp * p.len, ty = p.y - p.vy / sp * p.len
  var grad = ctx.createLinearGradient(p.x, p.y, tx, ty)
  grad.addColorStop(0, "rgba(255,250,220,1)")
  grad.addColorStop(0.3, "rgba(255,214,140,0.6)")
  grad.addColorStop(1, "rgba(255,180,120,0)")
  ctx.strokeStyle = grad
  ctx.lineWidth = 2.2
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(tx, ty)
  ctx.stroke()
  ctx.fillStyle = "#fffbe8"
  ctx.beginPath()
  ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2)
  ctx.fill()
}

function drawLeaf(ctx, p) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  // Seen edge-on as it tumbles.
  ctx.scale(1, p.rest ? 0.55 : 0.35 + 0.65 * Math.abs(Math.cos(p.phase)))
  var r = p.r
  ctx.beginPath()
  ctx.moveTo(-r, 0)
  ctx.quadraticCurveTo(-r * 0.2, -r * 0.75, r, 0)
  ctx.quadraticCurveTo(-r * 0.2, r * 0.75, -r, 0)
  ctx.fillStyle = LEAF_COLORS[p.hue % LEAF_COLORS.length]
  ctx.fill()
  ctx.strokeStyle = "rgba(60,30,10,0.45)"
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(-r * 1.25, 0)
  ctx.lineTo(r * 0.8, 0)
  ctx.stroke()
  ctx.restore()
}

function drawPetal(ctx, p) {
  var fade = p.rest && p.restLeft < 2 ? Math.max(0, p.restLeft / 2) : 1
  ctx.save()
  ctx.globalAlpha = fade
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  ctx.scale(1, p.rest ? 0.6 : 0.4 + 0.6 * Math.abs(Math.sin(p.phase)))
  var r = p.r
  ctx.beginPath()
  ctx.moveTo(0, r * 0.7)
  ctx.bezierCurveTo(-r * 1.2, r * 0.2, -r * 0.7, -r, -r * 0.15, -r * 0.8)
  ctx.lineTo(0, -r * 0.45)
  ctx.lineTo(r * 0.15, -r * 0.8)
  ctx.bezierCurveTo(r * 0.7, -r, r * 1.2, r * 0.2, 0, r * 0.7)
  ctx.fillStyle = PETAL_COLORS[p.hue % PETAL_COLORS.length]
  ctx.fill()
  ctx.restore()
}

function drawFirefly(ctx, p) {
  var glow = 0.35 + 0.65 * Math.max(0, Math.sin(p.phase))
  var R = p.r * 6
  var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R)
  g.addColorStop(0, "rgba(255,246,170," + (0.9 * glow) + ")")
  g.addColorStop(0.25, "rgba(220,255,120," + (0.35 * glow) + ")")
  g.addColorStop(1, "rgba(200,255,100,0)")
  ctx.fillStyle = g
  ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2)
}

function drawBolt(ctx, bolt) {
  var a = 1 - bolt.age / 0.22
  ctx.strokeStyle = "rgba(235,240,255," + a + ")"
  ctx.lineWidth = 2
  ctx.lineJoin = "round"
  ctx.beginPath()
  ctx.moveTo(bolt.points[0][0], bolt.points[0][1])
  for (var i = 1; i < bolt.points.length; i++) ctx.lineTo(bolt.points[i][0], bolt.points[i][1])
  ctx.stroke()
}

// ------------------------------------------------------------- decorations
// Each draws into a box of (w, h) with the item's feet at the bottom centre.

function snowman(ctx, w, h, opts) {
  opts = opts || {}
  ctx.clearRect(0, 0, w, h)
  var cx = w / 2
  var r1 = w * 0.36, r2 = w * 0.27, r3 = w * 0.2
  var y1 = h - r1, y2 = y1 - r1 - r2 * 0.75, y3 = y2 - r2 - r3 * 0.75
  var balls = [[cx, y1, r1], [cx, y2, r2], [cx, y3, r3]]
  var built = opts.built === undefined ? 1 : opts.built
  for (var i = 0; i < 3; i++) {
    var grow = Math.max(0, Math.min(1, built * 3 - i))
    if (grow <= 0) continue
    var b = balls[i]
    var g = ctx.createRadialGradient(b[0] - b[2] * 0.35, b[1] - b[2] * 0.4, b[2] * 0.1, b[0], b[1], b[2] * grow)
    g.addColorStop(0, "#ffffff")
    g.addColorStop(1, "#d6e2f2")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(b[0], b[1], b[2] * grow, 0, Math.PI * 2)
    ctx.fill()
  }
  if (built < 1) return
  // Buttons, eyes, carrot, scarf, hat.
  ctx.fillStyle = "#2b2b33"
  for (var k = 0; k < 3; k++) {
    ctx.beginPath(); ctx.arc(cx, y2 - r2 * 0.45 + k * r2 * 0.45, r2 * 0.09, 0, Math.PI * 2); ctx.fill()
  }
  ctx.beginPath(); ctx.arc(cx - r3 * 0.35, y3 - r3 * 0.2, r3 * 0.1, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(cx + r3 * 0.35, y3 - r3 * 0.2, r3 * 0.1, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#f08a24"
  ctx.beginPath()
  ctx.moveTo(cx, y3 - r3 * 0.02); ctx.lineTo(cx + r3 * 0.95, y3 + r3 * 0.12); ctx.lineTo(cx, y3 + r3 * 0.22)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = opts.scarf || "#c0392b"
  ctx.fillRect(cx - r3 * 1.05, y3 + r3 * 0.62, r3 * 2.1, r3 * 0.32)
  ctx.fillRect(cx + r3 * 0.3, y3 + r3 * 0.7, r3 * 0.34, r3 * 1.0)
  ctx.fillStyle = "#1f1f26"
  ctx.fillRect(cx - r3 * 0.95, y3 - r3 * 0.98, r3 * 1.9, r3 * 0.2)
  ctx.fillRect(cx - r3 * 0.62, y3 - r3 * 1.85, r3 * 1.24, r3 * 0.9)
  // Stick arms.
  ctx.strokeStyle = "#5b3b22"
  ctx.lineWidth = Math.max(1, w * 0.025)
  ctx.beginPath()
  ctx.moveTo(cx - r2 * 0.9, y2); ctx.lineTo(cx - r2 * 2.0, y2 - r2 * 0.7)
  ctx.moveTo(cx + r2 * 0.9, y2); ctx.lineTo(cx + r2 * 2.0, y2 - r2 * 0.8)
  ctx.stroke()
}

// tree: { growth 0..1, ornaments: [{kind, u, v, color}], star }
// u runs -1..1 across the tree, v 0..1 from top to bottom.
function tree(ctx, w, h, t, time) {
  ctx.clearRect(0, 0, w, h)
  var growth = t.growth === undefined ? 1 : t.growth
  var cx = w / 2
  var trunkH = h * 0.1
  var top = h * 0.08 + (1 - growth) * h * 0.85
  var base = h - trunkH
  ctx.fillStyle = "#6b4226"
  ctx.fillRect(cx - w * 0.06, base, w * 0.12, trunkH)
  if (growth < 0.05) return
  var tiers = 3
  for (var i = 0; i < tiers; i++) {
    var t0 = top + (base - top) * (i / tiers) * 0.85
    var t1 = top + (base - top) * ((i + 1) / tiers)
    var half = (w * 0.48) * ((i + 1) / tiers) * growth
    ctx.fillStyle = i % 2 ? "#1f7a4a" : "#238a52"
    ctx.beginPath()
    ctx.moveTo(cx, t0)
    ctx.lineTo(cx + half, t1)
    ctx.quadraticCurveTo(cx, t1 + h * 0.03, cx - half, t1)
    ctx.closePath()
    ctx.fill()
    // Snow on the boughs.
    ctx.strokeStyle = "rgba(255,255,255,0.85)"
    ctx.lineWidth = Math.max(1, h * 0.012)
    ctx.beginPath()
    ctx.moveTo(cx - half * 0.92, t1 - 1)
    ctx.quadraticCurveTo(cx, t1 + h * 0.025, cx + half * 0.92, t1 - 1)
    ctx.stroke()
  }
  if (growth < 1) return
  var orn = t.ornaments || []
  for (var k = 0; k < orn.length; k++) {
    var o = orn[k]
    var p = ornamentPoint(w, h, o.u, o.v)
    if (o.kind === "bauble") {
      ctx.fillStyle = o.color || "#e74c3c"
      ctx.beginPath(); ctx.arc(p.x, p.y, w * 0.045, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      ctx.beginPath(); ctx.arc(p.x - w * 0.015, p.y - w * 0.015, w * 0.012, 0, Math.PI * 2); ctx.fill()
    } else if (o.kind === "light") {
      var on = 0.45 + 0.55 * Math.abs(Math.sin((time || 0) * 2.2 + k * 1.7))
      ctx.fillStyle = o.color || "#ffd84d"
      ctx.globalAlpha = on
      ctx.beginPath(); ctx.arc(p.x, p.y, w * 0.025, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = on * 0.25
      ctx.beginPath(); ctx.arc(p.x, p.y, w * 0.06, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    } else if (o.kind === "candy") {
      ctx.lineWidth = w * 0.022
      ctx.lineCap = "round"
      ctx.strokeStyle = "#ffffff"
      ctx.beginPath()
      ctx.moveTo(p.x, p.y + w * 0.06); ctx.lineTo(p.x, p.y - w * 0.02)
      ctx.arc(p.x + w * 0.025, p.y - w * 0.02, w * 0.025, Math.PI, 0)
      ctx.stroke()
      ctx.strokeStyle = "#e0303a"
      ctx.lineWidth = w * 0.01
      ctx.beginPath()
      for (var s = 0; s < 3; s++) { ctx.moveTo(p.x - w * 0.012, p.y + w * 0.05 - s * w * 0.025); ctx.lineTo(p.x + w * 0.012, p.y + w * 0.035 - s * w * 0.025) }
      ctx.stroke()
    }
  }
  if (t.star) starShape(ctx, cx, top, w * 0.09, "#ffd84d")
}

// Where an ornament at (u, v) sits on the tree, clamped inside its outline.
function ornamentPoint(w, h, u, v) {
  var top = h * 0.08, base = h * 0.9
  var y = top + (base - top) * (0.12 + 0.85 * v)
  var half = w * 0.46 * ((y - top) / (base - top))
  return { x: w / 2 + u * half * 0.85, y: y }
}

// The inverse, for placing an ornament where the user clicks. Null when the
// click is off the tree.
function ornamentAt(w, h, x, y) {
  var top = h * 0.08, base = h * 0.9
  if (y < top || y > base) return null
  var half = w * 0.46 * ((y - top) / (base - top))
  if (half < 2 || Math.abs(x - w / 2) > half) return null
  var v = ((y - top) / (base - top) - 0.12) / 0.85
  return { u: Math.max(-1, Math.min(1, (x - w / 2) / (half * 0.85))), v: Math.max(0, Math.min(1, v)) }
}

function starShape(ctx, x, y, r, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (var i = 0; i < 10; i++) {
    var a = -Math.PI / 2 + i * Math.PI / 5
    var rr = i % 2 ? r * 0.45 : r
    var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

function gift(ctx, w, h, color) {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color || "#2e86de"
  ctx.fillRect(w * 0.1, h * 0.35, w * 0.8, h * 0.65)
  ctx.fillStyle = "#f6d55c"
  ctx.fillRect(w * 0.44, h * 0.35, w * 0.12, h * 0.65)
  ctx.fillRect(w * 0.05, h * 0.28, w * 0.9, h * 0.14)
  ctx.strokeStyle = "#f6d55c"
  ctx.lineWidth = w * 0.07
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.28)
  ctx.quadraticCurveTo(w * 0.2, h * 0.02, w * 0.3, h * 0.26)
  ctx.moveTo(w * 0.5, h * 0.28)
  ctx.quadraticCurveTo(w * 0.8, h * 0.02, w * 0.7, h * 0.26)
  ctx.stroke()
}

function letter(ctx, w, h) {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = "#fbf3e0"
  ctx.fillRect(w * 0.05, h * 0.2, w * 0.9, h * 0.75)
  ctx.strokeStyle = "#b9a57f"
  ctx.lineWidth = 1
  ctx.strokeRect(w * 0.05, h * 0.2, w * 0.9, h * 0.75)
  ctx.beginPath()
  ctx.moveTo(w * 0.05, h * 0.2); ctx.lineTo(w * 0.5, h * 0.62); ctx.lineTo(w * 0.95, h * 0.2)
  ctx.stroke()
  ctx.fillStyle = "#c0392b"
  ctx.beginPath(); ctx.arc(w * 0.5, h * 0.6, w * 0.08, 0, Math.PI * 2); ctx.fill()
}

// ---------------------------------------------------------------- visitors
// frame: a running time in seconds for legs, wheels and bobbing.

function sleigh(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h)
  var bob = Math.sin(frame * 6) * h * 0.04
  // Reindeer, three in a line ahead of the sleigh (drawn facing right).
  for (var i = 0; i < 3; i++) {
    var rx = w * (0.62 + i * 0.13), ry = h * 0.45 + Math.sin(frame * 6 + i) * h * 0.05
    reindeer(ctx, rx, ry, h * 0.22, frame + i * 0.3, i === 2)
    ctx.strokeStyle = "rgba(120,70,30,0.9)"
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(w * 0.42, h * 0.55 + bob); ctx.lineTo(rx - h * 0.1, ry); ctx.stroke()
  }
  ctx.save()
  ctx.translate(0, bob)
  // Sleigh body.
  ctx.fillStyle = "#b3202a"
  ctx.beginPath()
  ctx.moveTo(w * 0.05, h * 0.45)
  ctx.lineTo(w * 0.42, h * 0.45)
  ctx.quadraticCurveTo(w * 0.46, h * 0.75, w * 0.34, h * 0.78)
  ctx.lineTo(w * 0.1, h * 0.78)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = "#e8c15a"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(w * 0.04, h * 0.88); ctx.lineTo(w * 0.4, h * 0.88)
  ctx.quadraticCurveTo(w * 0.47, h * 0.86, w * 0.46, h * 0.76)
  ctx.stroke()
  // Santa.
  ctx.fillStyle = "#c62828"
  ctx.beginPath(); ctx.arc(w * 0.24, h * 0.36, h * 0.13, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#f3c9a5"
  ctx.beginPath(); ctx.arc(w * 0.26, h * 0.17, h * 0.07, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.beginPath(); ctx.arc(w * 0.255, h * 0.23, h * 0.065, 0, Math.PI); ctx.fill()
  ctx.fillStyle = "#c62828"
  ctx.beginPath(); ctx.moveTo(w * 0.21, h * 0.13); ctx.lineTo(w * 0.31, h * 0.12); ctx.lineTo(w * 0.17, h * 0.02); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.beginPath(); ctx.arc(w * 0.17, h * 0.03, h * 0.025, 0, Math.PI * 2); ctx.fill()
  // Sack.
  ctx.fillStyle = "#7a5230"
  ctx.beginPath(); ctx.arc(w * 0.1, h * 0.36, h * 0.12, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

function reindeer(ctx, x, y, s, frame, lead) {
  ctx.fillStyle = "#8a5a35"
  ctx.beginPath(); ellipse(ctx, x, y, s * 0.55, s * 0.28); ctx.fill()
  ctx.beginPath(); ctx.arc(x + s * 0.6, y - s * 0.35, s * 0.18, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = "#8a5a35"
  ctx.lineWidth = Math.max(1, s * 0.1)
  var swing = Math.sin(frame * 10) * s * 0.25
  ctx.beginPath()
  ctx.moveTo(x - s * 0.35, y + s * 0.15); ctx.lineTo(x - s * 0.35 - swing, y + s * 0.6)
  ctx.moveTo(x + s * 0.35, y + s * 0.15); ctx.lineTo(x + s * 0.35 + swing, y + s * 0.6)
  ctx.moveTo(x + s * 0.45, y - s * 0.1); ctx.lineTo(x + s * 0.58, y - s * 0.3)
  ctx.stroke()
  ctx.strokeStyle = "#5b3b22"
  ctx.lineWidth = Math.max(1, s * 0.06)
  ctx.beginPath()
  ctx.moveTo(x + s * 0.55, y - s * 0.5); ctx.lineTo(x + s * 0.45, y - s * 0.85); ctx.lineTo(x + s * 0.32, y - s * 0.95)
  ctx.moveTo(x + s * 0.65, y - s * 0.5); ctx.lineTo(x + s * 0.75, y - s * 0.88)
  ctx.stroke()
  if (lead) {
    ctx.fillStyle = "#ff3030"
    ctx.beginPath(); ctx.arc(x + s * 0.78, y - s * 0.32, s * 0.08, 0, Math.PI * 2); ctx.fill()
  }
}

// facing: 1 right, -1 left. carrying: draw a snowman in its arms.
function yeti(ctx, w, h, frame, facing, carrying, scared) {
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  if (facing < 0) { ctx.translate(w, 0); ctx.scale(-1, 1) }
  var step = Math.sin(frame * (scared ? 16 : 8))
  var cx = w * 0.45
  // Legs.
  ctx.fillStyle = "#e9eef5"
  ctx.fillRect(cx - w * 0.16 + step * w * 0.04, h * 0.78, w * 0.13, h * 0.22)
  ctx.fillRect(cx + w * 0.04 - step * w * 0.04, h * 0.78, w * 0.13, h * 0.22)
  // Body and head, shaggy.
  ctx.beginPath(); ellipse(ctx, cx, h * 0.58, w * 0.3, h * 0.28); ctx.fill()
  ctx.beginPath(); ctx.arc(cx + w * 0.04, h * 0.25, w * 0.2, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = "#c9d3e0"
  ctx.lineWidth = 1
  ctx.beginPath()
  for (var i = 0; i < 9; i++) {
    var a = Math.PI * 0.15 + i * 0.3
    ctx.moveTo(cx + Math.cos(a) * w * 0.28, h * 0.58 + Math.sin(a) * h * 0.26)
    ctx.lineTo(cx + Math.cos(a) * w * 0.33, h * 0.58 + Math.sin(a) * h * 0.31)
  }
  ctx.stroke()
  // Face.
  ctx.fillStyle = "#8fb3d9"
  ctx.beginPath(); ellipse(ctx, cx + w * 0.1, h * 0.27, w * 0.11, h * 0.08); ctx.fill()
  ctx.fillStyle = "#1d2433"
  ctx.beginPath(); ctx.arc(cx + w * 0.06, h * 0.22, w * 0.025, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(cx + w * 0.15, h * 0.22, w * 0.025, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath()
  if (scared) ctx.arc(cx + w * 0.11, h * 0.31, w * 0.03, 0, Math.PI * 2)
  else { ctx.moveTo(cx + w * 0.06, h * 0.3); ctx.quadraticCurveTo(cx + w * 0.11, h * 0.34, cx + w * 0.16, h * 0.3) }
  ctx.fill()
  // Arms, up when carrying.
  ctx.fillStyle = "#e9eef5"
  if (carrying) {
    ctx.save(); ctx.translate(cx + w * 0.22, h * 0.45); ctx.rotate(-1.1)
    ctx.fillRect(0, -w * 0.06, w * 0.3, w * 0.12); ctx.restore()
    ctx.save(); ctx.translate(w * 0.62, -h * 0.05)
    snowmanMini(ctx, w * 0.36, h * 0.5)
    ctx.restore()
  } else {
    ctx.save(); ctx.translate(cx + w * 0.22, h * 0.48); ctx.rotate(0.6 + step * 0.3)
    ctx.fillRect(0, -w * 0.06, w * 0.26, w * 0.12); ctx.restore()
  }
  ctx.restore()
}

function snowmanMini(ctx, w, h) {
  ctx.fillStyle = "#ffffff"
  ctx.beginPath(); ctx.arc(w / 2, h * 0.75, w * 0.3, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(w / 2, h * 0.38, w * 0.22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#1f1f26"
  ctx.fillRect(w * 0.34, h * 0.06, w * 0.32, h * 0.14)
  ctx.fillStyle = "#f08a24"
  ctx.fillRect(w * 0.5, h * 0.38, w * 0.2, h * 0.04)
}

// A little engine with an elf and one wagon carrying `cargo`
// ("snowman", "tree", "note", "gift"); facing like the yeti.
function train(ctx, w, h, frame, facing, cargo) {
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  if (facing < 0) { ctx.translate(w, 0); ctx.scale(-1, 1) }
  var wheelY = h * 0.86, wr = h * 0.12
  // Wagon.
  ctx.fillStyle = "#2e7d4f"
  ctx.fillRect(w * 0.02, h * 0.55, w * 0.38, h * 0.25)
  if (cargo === "snowman") { ctx.save(); ctx.translate(w * 0.08, h * 0.0); snowmanMini(ctx, w * 0.26, h * 0.6); ctx.restore() }
  else if (cargo === "tree") {
    ctx.fillStyle = "#238a52"
    ctx.beginPath(); ctx.moveTo(w * 0.21, h * 0.05); ctx.lineTo(w * 0.34, h * 0.55); ctx.lineTo(w * 0.08, h * 0.55); ctx.closePath(); ctx.fill()
    starShape(ctx, w * 0.21, h * 0.07, h * 0.07, "#ffd84d")
  } else if (cargo === "note") { ctx.save(); ctx.translate(w * 0.09, h * 0.2); letter(ctx, w * 0.24, h * 0.35); ctx.restore() }
  else { ctx.save(); ctx.translate(w * 0.1, h * 0.18); gift(ctx, w * 0.22, h * 0.37, "#c0392b"); ctx.restore() }
  // Coupling and engine.
  ctx.fillStyle = "#3a3a44"
  ctx.fillRect(w * 0.4, h * 0.7, w * 0.06, h * 0.04)
  ctx.fillStyle = "#c0392b"
  ctx.fillRect(w * 0.46, h * 0.45, w * 0.32, h * 0.35)
  ctx.fillRect(w * 0.46, h * 0.25, w * 0.14, h * 0.22)
  ctx.fillStyle = "#3a3a44"
  ctx.fillRect(w * 0.78, h * 0.5, w * 0.16, h * 0.3)
  ctx.fillRect(w * 0.84, h * 0.3, w * 0.06, h * 0.2)
  // Elf in the cab.
  ctx.fillStyle = "#f3c9a5"
  ctx.beginPath(); ctx.arc(w * 0.53, h * 0.2, h * 0.07, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#2e9e5b"
  ctx.beginPath(); ctx.moveTo(w * 0.48, h * 0.16); ctx.lineTo(w * 0.58, h * 0.16); ctx.lineTo(w * 0.47, h * 0.02); ctx.closePath(); ctx.fill()
  // Smoke puffs.
  ctx.fillStyle = "rgba(230,230,235,0.7)"
  for (var s = 0; s < 3; s++) {
    var t = (frame * 1.4 + s / 3) % 1
    ctx.beginPath(); ctx.arc(w * (0.87 - t * 0.25), h * (0.26 - t * 0.22), h * (0.04 + t * 0.06), 0, Math.PI * 2); ctx.fill()
  }
  // Wheels with turning spokes.
  var wheels = [w * 0.1, w * 0.32, w * 0.55, w * 0.85]
  for (var k = 0; k < wheels.length; k++) {
    ctx.fillStyle = "#26262e"
    ctx.beginPath(); ctx.arc(wheels[k], wheelY, wr, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "#9aa0aa"
    ctx.lineWidth = 1
    ctx.beginPath()
    var a = frame * 9
    ctx.moveTo(wheels[k] + Math.cos(a) * wr, wheelY + Math.sin(a) * wr)
    ctx.lineTo(wheels[k] - Math.cos(a) * wr, wheelY - Math.sin(a) * wr)
    ctx.stroke()
  }
  ctx.restore()
}
