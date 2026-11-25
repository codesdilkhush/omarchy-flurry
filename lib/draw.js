.pragma library

// Drawing for Flurry. Everything is painted procedurally on a QML Canvas
// 2D context, so the plugin ships no image assets. Particles are drawn in
// batches (one path per kind and shade) to keep the per-frame cost flat.

var LEAF_COLORS = ["#d9822b", "#c2452d", "#e3b23c", "#8c5a2b"]
var PETAL_COLORS = ["#f7c6d9", "#f4a7c3", "#fde2ec"]
var SPARK_COLORS = ["#fff4c2", "#ffd27a", "#ff9e5e"]
var BLOSSOM_COLORS = ["#fff7f4", "#fbe4ea", "#f5d2de"]
var FIREWORK_COLORS = ["#ffe7a8", "#ffd1dc", "#cfe3ff", "#d9f5e4", "#fff6e0"]

// Colours from the Omarchy theme (lib/theme.js derive()), or null for
// Flurry's own. One for the whole shell: every canvas paints with it.
var THEME = null
function setTheme(t) { THEME = t && t.lights ? t : null }

function world(ctx, w, opts) {
  opts = opts || {}
  ctx.clearRect(0, 0, w.width, w.height)
  // Everything in the air is painted first, behind the windows: each
  // window's face is cleared before its snow is painted (drawHeaps), so
  // fireworks, falling flakes, powder and chunks, rain, lightning and its
  // flash show only between and around the windows, never over what is in
  // them. The extras are each painted guarded (see layer): one that throws
  // is skipped and noted, and the rest of the frame is still painted.
  if (w.fw || hasKind(w, "ember")) layer(ctx, w, "draw:fireworks", drawFireworks)
  drawParticles(ctx, w, false)
  if (w.bolt) drawBolt(ctx, w.bolt)
  if (w.flash > 0.01) {
    ctx.globalAlpha = Math.min(0.35, w.flash * 0.35)
    ctx.fillStyle = "#e8f0ff"
    ctx.fillRect(0, 0, w.width, w.height)
    ctx.globalAlpha = 1
  }
  drawHeaps(ctx, w)
  if (w.plow) layer(ctx, w, "draw:plow", drawPlow)
  if (w.balls && w.balls.length) layer(ctx, w, "draw:snowballs", drawBalls)
  // What rests on a window or the ground sits on top of it.
  drawParticles(ctx, w, true)
  if (w.bird) layer(ctx, w, "draw:bird", function(c, ww) { drawBird(c, ww.bird, ww.time) })
  if (w.golden) layer(ctx, w, "draw:golden", function(c, ww) { drawGolden(c, ww.golden, ww.time) })
}

function hasKind(w, kind) {
  for (var i = 0; i < w.particles.length; i++) if (w.particles[i].kind === kind) return true
  return false
}

// Paints one layer of the frame. An exception thrown inside a QML Canvas
// onPaint ends the whole paint, so whatever comes after it (the ground,
// the visitors) would never be drawn again; here it is caught, the context
// is put back (saves the layer left open are unwound) and it is noted once
// in w.faults for the shell's log and `flurry diag`.
function layer(ctx, w, name, fn, arg) {
  ctx.save()
  try {
    fn(ctx, w, arg)
  } catch (e) {
    if (!w.faults) w.faults = {}
    if (w.faults[name]) w.faults[name].count++
    else { w.faults[name] = { message: String(e && e.message ? e.message : e), at: w.time, count: 1 }; w.faultSeq = (w.faultSeq || 0) + 1 }
    // Unwind whatever the layer left saved; extra restores are no-ops.
    for (var i = 0; i < 12; i++) ctx.restore()
    ctx.save()
  }
  ctx.restore()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
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
    if (s.plow) continue
    ctx.clearRect(s.x, s.y, s.w, s.h)
    // Frost first, on the window's face, then the snow over it.
    if (s.frost > 0.04) layer(ctx, w, "draw:frost", drawFrostLayer, s)
    drawCap(ctx, s, w.time)
    if (s.icicles) layer(ctx, w, "draw:icicles", drawIciclesLayer, s)
    if (w.strings) for (var id in w.strings) if (w.strings[id].surface === s.id) drawString(ctx, w.strings[id], s, w.time)
  }
  // Sprouts and the hare stand in the ground snow, so it is painted over
  // their roots and feet.
  if (w.sprouts) layer(ctx, w, "draw:sprouts", drawSprouts)
  if (w.rabbit) layer(ctx, w, "draw:rabbit", function(c, ww) { drawRabbit(c, ww.rabbit) })
  if (ground) drawCap(ctx, ground, w.time)
}

function drawCap(ctx, s, time) {
  var b = s.bins
  var n = b.length
  var top = 0
  for (var k = 0; k < n; k++) if (b[k] > top) top = b[k]
  var hangL = s.edges ? s.edges[0].m : 0
  var hangR = s.edges ? s.edges[1].m : 0
  if (top < 0.15 && hangL < 0.1 && hangR < 0.1) return
  var cell = s.w / n
  // The profile, softened: a lying layer of snow is rounded, so the cells'
  // steps are blurred (twice, [1 2 1]) into a soft, continuous top. The
  // height field itself is untouched.
  var h = smoothed(b, s.ground ? 1 : 2)
  // A lying layer is never quite level: a gentle, fixed undulation (in the
  // window's own frame, so it rides along) keeps a full ledge from reading
  // as a flat slab. Drawing only; the height field is untouched.
  var seed = s.ground ? 0 : (hashString(String(s.id)) % 628) / 100
  for (var u = 0; u < n; u++) {
    if (h[u] < 0.5) continue
    var wob = Math.sin(u * 0.23 + seed) * 0.55 + Math.sin(u * 0.071 + seed * 2.3) * 0.9
    h[u] = Math.max(0, h[u] + wob * Math.min(1, h[u] / 9))
  }
  var y0 = s.y + (s.ground ? 0.5 : 0.6)
  // A cornice: the cap rounds over the window's edge and curls a little
  // past it, further while snow is about to pour over it.
  var lipL = s.ground ? 0 : Math.min(5, h[0] * 0.32 + Math.sqrt(hangL) * 2)
  var lipR = s.ground ? 0 : Math.min(5, h[n - 1] * 0.32 + Math.sqrt(hangR) * 2)
  // A crisp lit edge along the top gives it its softness (light from
  // above): the outline filled near-white, then the body filled over it a
  // pixel lower, which leaves that pixel showing along the top. Two fills
  // cost less than stroking the profile.
  capPath(ctx, s, h, cell, lipL, lipR, y0)
  ctx.fillStyle = "rgba(255,255,255,0.97)"
  ctx.fill()
  var g = ctx.createLinearGradient(0, s.y - top + 1.1, 0, s.y + 1)
  // Settled snow is a touch greyer and bluer than fresh powder; its shade
  // leans toward the theme's blue.
  var pack = s.pack === undefined ? 0.5 : s.pack
  g.addColorStop(0, "rgba(250,252,255,0.98)")
  g.addColorStop(0.45, "rgba(242,247,255,0.98)")
  if (THEME) g.addColorStop(1, rgba(shade(rgbOf(THEME.shadow), pack > 0.6 ? 0.05 : 0.3), 0.97))
  else g.addColorStop(1, pack > 0.6 ? "rgba(206,220,240,0.97)" : "rgba(222,232,247,0.97)")
  capPath(ctx, s, h, cell, lipL * 0.85, lipR * 0.85, y0, 1.1)
  ctx.fillStyle = g
  ctx.fill()
  // Where it rests on a window, a soft contact shadow on the window's top
  // edge grounds it.
  if (!s.ground && top > 0.8) {
    // A flat band rather than a gradient: as soft at this size, and cheaper.
    ctx.beginPath()
    var run = -1
    for (var i = 0; i <= n; i++) {
      var on = i < n && h[i] > 0.6
      if (on && run < 0) run = i
      if (!on && run >= 0) { ctx.rect(s.x + run * cell, s.y + 0.5, (i - run) * cell, 2); run = -1 }
    }
    ctx.fillStyle = "rgba(8,12,24,0.15)"
    ctx.fill()
  }
  // A night's glaze: the top catches the light along its edge.
  var glaze = s.glaze || 0
  if (glaze > 0.04) {
    topPath(ctx, s, h, cell, lipL, lipR, 0.3)
    ctx.strokeStyle = "rgba(236,246,255," + (0.6 * glaze).toFixed(3) + ")"
    ctx.lineWidth = 1
    ctx.stroke()
  }
  if (s.rho && s.rho.length === n) drawPressed(ctx, s, cell)
  if (s.marks && s.marks.length) drawMarks(ctx, s)
  if (glaze > 0.04) drawGlints(ctx, s, cell, glaze, time || 0)
}

// The cap's outline: the soft top, the rounded cornice at each end, closed
// along the surface.
function capPath(ctx, s, h, cell, lipL, lipR, y0, dy) {
  dy = dy || 0
  var m = s.bins.length
  var n = profile(s, h, m, cell, dy)
  var ex = s.x + s.w, sy = s.y + dy
  ctx.beginPath()
  ctx.moveTo(s.x + lipL * 0.35, y0)
  ctx.bezierCurveTo(s.x - lipL * 0.9, y0, s.x - lipL, sy - h[0] * 0.75, s.x - lipL * 0.25, sy - h[0] * 0.98)
  tracePoints(ctx, n)
  ctx.bezierCurveTo(ex + lipR, sy - h[m - 1] * 0.75, ex + lipR * 0.9, y0, ex - lipR * 0.35, y0)
  ctx.closePath()
}

// The top of the cap as a short list of points (PX, PY): the smoothed
// heights, thinned to within a third of a pixel, so a long, even layer is
// a few dozen curves rather than hundreds.
var PX = [], PY = []
function profile(s, h, n, cell, dy) {
  var k = 0, last = 0
  PX[0] = s.x + 0.5 * cell; PY[0] = s.y - h[0] + dy; k = 1
  // Greedy line simplification: from the last point kept, reach as far as
  // a straight run stays within a third of a pixel of every height it
  // skips (at most 10 cells), and keep the point before it breaks.
  var j = 1
  while (j < n) {
    var ok = j
    for (var e = j + 1; e < n && e - last <= 10; e++) {
      var bad = false
      var he = h[e], hl = h[last], span = e - last
      for (var q = last + 1; q < e; q++) {
        var lin = hl + (he - hl) * (q - last) / span
        if (Math.abs(h[q] - lin) > 0.33) { bad = true; break }
      }
      if (bad) break
      ok = e
    }
    PX[k] = s.x + (ok + 0.5) * cell
    PY[k] = s.y - h[ok] + dy
    k++
    last = ok
    j = ok + 1
  }
  return k
}

// A smooth curve through the profile's points (quadratics through their
// midpoints), from the current point to the last one.
function tracePoints(ctx, k) {
  ctx.lineTo(PX[0], PY[0])
  for (var i = 0; i + 1 < k; i++) ctx.quadraticCurveTo(PX[i], PY[i], (PX[i] + PX[i + 1]) / 2, (PY[i] + PY[i + 1]) / 2)
  ctx.lineTo(PX[k - 1], PY[k - 1])
}

// Just the top of the cap, `dy` px below its outline, for the lit edge.
function topPath(ctx, s, h, cell, lipL, lipR, dy) {
  var m = s.bins.length
  var n = profile(s, h, m, cell, dy)
  ctx.beginPath()
  ctx.moveTo(s.x - lipL * 0.25, s.y - h[0] * 0.98 + dy)
  tracePoints(ctx, n)
  ctx.lineTo(s.x + s.w + lipR * 0.25, s.y - h[m - 1] * 0.98 + dy)
}

// The heights blurred `passes` times with a [1 2 1] kernel into a scratch
// buffer that is reused from frame to frame (no allocation per cap). The
// buffer may be longer than b: only its first b.length entries are this
// surface's.
var SMOOTH_A = [], SMOOTH_B = []
function smoothed(b, passes) {
  var n = b.length
  var src = b, dst = SMOOTH_A
  for (var p = 0; p < passes; p++) {
    dst = p % 2 === 0 ? SMOOTH_A : SMOOTH_B
    if (dst.length < n) dst.length = n
    for (var i = 0; i < n; i++) {
      var l = src[i > 0 ? i - 1 : 0], r = src[i + 1 < n ? i + 1 : n - 1]
      dst[i] = (l + 2 * src[i] + r) * 0.25
    }
    // Keep the ends at least as tall as they are: the cornice sits on them.
    src = dst
  }
  return passes ? dst : b
}

// Snow a ball has pressed down: a smooth, faintly glazed track, with a
// shaded wall where it drops below the untouched snow beside it.
function drawPressed(ctx, s, cell) {
  var b = s.bins, rho = s.rho, n = b.length
  ctx.beginPath()
  var open = false
  for (var i = 0; i < n; i++) {
    var firm = rho[i] > 1.3 && b[i] > 0.4
    var x = s.x + (i + 0.5) * cell, y = s.y - b[i] + 0.6
    if (firm && !open) { ctx.moveTo(x - cell * 0.5, y); open = true }
    if (firm) ctx.lineTo(x + cell * 0.5, y)
    else open = false
  }
  ctx.strokeStyle = "rgba(150,176,218,0.6)"
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.beginPath()
  for (var j = 0; j < n; j++) {
    if (!(rho[j] > 1.3 && b[j] > 0.4)) continue
    var xx = s.x + (j + 0.5) * cell, yy = s.y - b[j] + 2.2
    ctx.moveTo(xx - cell * 0.5, yy)
    ctx.lineTo(xx + cell * 0.5, yy)
  }
  ctx.strokeStyle = "rgba(255,255,255,0.55)"
  ctx.lineWidth = 0.8
  ctx.stroke()
}

// Buckets reused from frame to frame, so drawing allocates nothing per
// particle. `resting` picks what lies on something (true) or what is in
// the air (false); see world().
var PB = { flakesNear: [], flakesFar: [], clumps: [], drops: [], splashes: [], ripples: [], dustThick: [], dustThin: [],
           meteors: [], sparks: [], leaves: [], petals: [], flies: [], drips: [], shards: [], smokeNew: [], smokeMid: [], smokeOld: [] }
function drawParticles(ctx, w, resting) {
  var ps = w.particles
  for (var key in PB) PB[key].length = 0
  var flakesNear = PB.flakesNear, flakesFar = PB.flakesFar, clumps = PB.clumps, drops = PB.drops, splashes = PB.splashes, ripples = PB.ripples
  var dustThick = PB.dustThick, dustThin = PB.dustThin
  var meteors = PB.meteors, sparks = PB.sparks, leaves = PB.leaves, petals = PB.petals, flies = PB.flies, drips = PB.drips, shards = PB.shards
  var smokeNew = PB.smokeNew, smokeMid = PB.smokeMid, smokeOld = PB.smokeOld
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i]
    if ((p.rest !== null && p.rest !== undefined) !== !!resting) continue
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
    case "drip": drips.push(p); break
    case "shard": shards.push(p); break
    case "smoke":
      var sa = p.age / p.life
      ;(sa < 0.25 ? smokeNew : (sa < 0.6 ? smokeMid : smokeOld)).push(p)
      break
    }
  }
  // Exhaust, oldest (thinnest) first so fresh puffs sit on top.
  dots(ctx, smokeOld, "rgba(150,156,168,0.10)")
  dots(ctx, smokeMid, "rgba(128,134,146,0.20)")
  dots(ctx, smokeNew, "rgba(92,96,106,0.34)")
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
  if (drips.length) {
    // Meltwater: a bead with a short streak above it.
    ctx.beginPath()
    for (var di = 0; di < drips.length; di++) {
      var dp = drips[di]
      var st = Math.min(5, dp.vy * 0.012)
      ctx.moveTo(dp.x, dp.y - st); ctx.lineTo(dp.x, dp.y)
    }
    ctx.strokeStyle = "rgba(214,232,255,0.75)"
    ctx.lineWidth = 1.1
    ctx.lineCap = "round"
    ctx.stroke()
  }
  for (var si = 0; si < shards.length; si++) drawShard(ctx, shards[si])
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
  for (var c = 0; c < SPARK_COLORS.length && sparks.length; c++) {
    ctx.beginPath()
    var anySpark = false
    for (var g = 0; g < sparks.length; g++) {
      var sp = sparks[g]
      if (sp.hue !== c) continue
      anySpark = true
      var rr = sp.r * (1 - sp.age / sp.life)
      ctx.moveTo(sp.x + rr, sp.y)
      ctx.arc(sp.x, sp.y, Math.max(0.3, rr), 0, Math.PI * 2)
    }
    if (!anySpark) continue
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
  ctx.fillStyle = (p.blossom ? BLOSSOM_COLORS : PETAL_COLORS)[p.hue % 3]
  ctx.fill()
  if (p.blossom) {
    // A faint blush at the base of an almond petal.
    ctx.fillStyle = "rgba(226,140,168,0.25)"
    ctx.beginPath(); ctx.arc(0, r * 0.45, r * 0.28, 0, Math.PI * 2); ctx.fill()
  }
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


// ------------------------------------------------------------- the tree
//
// tree: { growth 0..1, ornaments: [{kind, u, v, color}], star, seed }
// u runs -1..1 across the tree, v 0..1 from top to bottom.
//
// The tree is painted in two layers. `tree` is everything that holds still
// (boughs, needles, snow, baubles, candy canes, the star's body, the light
// wire) and is repainted only when something changes. `treeLights` is what
// moves: the bulbs, the light they throw on the needles, the glints they
// put in the baubles, and the star's glow. Light comes from the upper left.

var TREE = {
  tiers: 6,
  needles: ["#4fb36f", "#2f8c4f", "#226f3d", "#185530", "#0f3d22"],
  bark: ["#7a4b2a", "#4e2d17"]
}

// A small seeded generator so a tree's needles are the same every paint.
function seeded(seed) {
  var x = (seed | 0) || 1
  return function() {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    return ((x >>> 0) % 100000) / 100000
  }
}

function hashString(str) {
  var hsh = 2166136261
  str = String(str || "flurry")
  for (var i = 0; i < str.length; i++) { hsh ^= str.charCodeAt(i); hsh = (hsh * 16777619) >>> 0 }
  return hsh
}

// Colour helpers: "#rrggbb" in, "rgba(...)" out.
function rgbOf(hex) {
  hex = String(hex || "#ffffff").replace("#", "")
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  var n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (a === undefined ? 1 : +a.toFixed(3)) + ")" }
function shade(c, t) {
  // t > 0 toward white, t < 0 toward black.
  return t >= 0 ? [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t]
                : [c[0] * (1 + t), c[1] * (1 + t), c[2] * (1 + t)]
}

// Tier outlines, shared by the painter and the ornament placement.
function treeGeometry(w, h) {
  var top = h * 0.08, base = h * 0.9
  var tiers = []
  for (var i = 0; i < TREE.tiers; i++) {
    var f0 = i / TREE.tiers, f1 = (i + 1) / TREE.tiers
    var y0 = top + (base - top) * Math.max(0, f0 - 0.06) - (i === 0 ? h * 0.01 : 0)
    var y1 = top + (base - top) * f1
    var half = w * 0.485 * Math.min(1, f1 * 1.02)
    tiers.push({ y0: y0, y1: y1, half: half, halfTop: i === 0 ? 0 : w * 0.485 * f0 * 0.55, tips: 2 + i })
  }
  return { top: top, base: base, cx: w / 2, tiers: tiers }
}

// The outline of one tier: a drooping cone, its hem scalloped into bough tips.
function tierPath(ctx, g, t, dy) {
  var cx = g.cx
  dy = dy || 0
  var droop = (t.y1 - t.y0) * 0.1
  ctx.beginPath()
  ctx.moveTo(cx - t.halfTop * 0.5, t.y0 + dy)
  ctx.lineTo(cx + t.halfTop * 0.5, t.y0 + dy)
  ctx.quadraticCurveTo(cx + t.half * 0.55, t.y0 + (t.y1 - t.y0) * 0.45 + dy, cx + t.half, t.y1 + droop + dy)
  var n = t.tips
  for (var k = n - 1; k >= 0; k--) {
    var xa = cx - t.half + (2 * t.half) * (k + 1) / n
    var xb = cx - t.half + (2 * t.half) * k / n
    var mid = (xa + xb) / 2
    var tipY = t.y1 + droop * (0.4 + 0.6 * Math.abs(mid - cx) / t.half) + dy
    ctx.quadraticCurveTo(mid + (xa - xb) * 0.15, t.y1 - droop * 1.4 + dy, mid, tipY + droop * 0.6)
    ctx.quadraticCurveTo(mid - (xa - xb) * 0.15, t.y1 - droop * 1.2 + dy, xb, (k === 0 ? t.y1 + droop : t.y1) + dy)
  }
  ctx.quadraticCurveTo(cx - t.half * 0.55, t.y0 + (t.y1 - t.y0) * 0.45 + dy, cx - t.halfTop * 0.5, t.y0 + dy)
  ctx.closePath()
}

function tree(ctx, w, h, t, time) {
  ctx.clearRect(0, 0, w, h)
  var growth = t.growth === undefined ? 1 : t.growth
  var g = treeGeometry(w, h)
  var cx = g.cx
  var rnd = seeded(hashString(t.seed))

  // Shadow on the ground.
  var sh = ctx.createRadialGradient(cx, h - 1, 1, cx, h - 1, w * 0.42 * Math.max(0.2, growth))
  sh.addColorStop(0, "rgba(10,16,28,0.38)")
  sh.addColorStop(1, "rgba(10,16,28,0)")
  ctx.fillStyle = sh
  ctx.save(); ctx.translate(cx, h - 1); ctx.scale(1, 0.16); ctx.translate(-cx, -(h - 1))
  ctx.beginPath(); ctx.arc(cx, h - 1, w * 0.42 * Math.max(0.2, growth), 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  // Trunk, with bark.
  var tw = w * 0.075 * Math.max(0.3, growth)
  var bark = ctx.createLinearGradient(cx - tw, 0, cx + tw, 0)
  bark.addColorStop(0, "#9a6438"); bark.addColorStop(0.45, TREE.bark[0]); bark.addColorStop(1, TREE.bark[1])
  ctx.fillStyle = bark
  ctx.fillRect(cx - tw, g.base - h * 0.02, tw * 2, h - g.base + h * 0.02 - 1)
  ctx.strokeStyle = "rgba(40,22,10,0.45)"
  ctx.lineWidth = 0.7
  ctx.beginPath()
  for (var b = 0; b < 4; b++) { var bx = cx - tw * 0.6 + b * tw * 0.4; ctx.moveTo(bx, g.base); ctx.lineTo(bx + 0.6, h - 2) }
  ctx.stroke()
  // Snow heaped round the foot of the trunk.
  var mound = w * 0.16 * Math.max(0.3, growth)
  var mg = ctx.createLinearGradient(0, h - 6, 0, h)
  mg.addColorStop(0, "#ffffff"); mg.addColorStop(1, "#d5e1f2")
  ctx.fillStyle = mg
  ctx.beginPath()
  ctx.moveTo(cx - mound, h)
  ctx.quadraticCurveTo(cx - mound * 0.6, h - 5, cx - tw * 0.4, h - 4.5)
  ctx.quadraticCurveTo(cx + mound * 0.2, h - 6, cx + mound * 0.55, h - 3.5)
  ctx.quadraticCurveTo(cx + mound * 0.85, h - 2, cx + mound, h)
  ctx.closePath(); ctx.fill()
  if (growth < 0.05) return

  // The tree grows from its base.
  ctx.save()
  ctx.translate(cx, g.base); ctx.scale(growth, growth); ctx.translate(-cx, -g.base)

  for (var i = TREE.tiers - 1; i >= 0; i--) {
    var tier = g.tiers[i]
    // The tier above casts a soft shadow on this one: paint it first, offset.
    if (i < TREE.tiers - 1) {
      // (cast by this tier onto the one below, which is already painted)
      ctx.fillStyle = "rgba(4,22,10,0.38)"
      tierPath(ctx, g, tier, h * 0.018)
      ctx.fill()
    }
    // Body: lit from the upper left, deeper toward the trunk.
    var body = ctx.createLinearGradient(cx - tier.half, tier.y0, cx + tier.half, tier.y1)
    body.addColorStop(0, "#2f8f4e"); body.addColorStop(0.45, "#1e6d3a"); body.addColorStop(1, "#0f4224")
    ctx.fillStyle = body
    tierPath(ctx, g, tier, 0)
    ctx.fill()
    var depth = ctx.createLinearGradient(0, tier.y0, 0, tier.y1)
    depth.addColorStop(0, "rgba(0,20,8,0.28)"); depth.addColorStop(0.5, "rgba(0,20,8,0)"); depth.addColorStop(1, "rgba(160,230,170,0.08)")
    ctx.fillStyle = depth
    ctx.fill()
    needles(ctx, g, tier, rnd, i)
    // A cool rim of sky light on the tips.
    ctx.strokeStyle = "rgba(196,220,255,0.13)"
    ctx.lineWidth = 0.9
    tierPath(ctx, g, tier, -0.4)
    ctx.stroke()
    boughSnow(ctx, g, tier, rnd)
  }
  // Light wire between the bulbs, in the order they were hung.
  if (growth >= 1) {
    lightWire(ctx, w, h, t.ornaments || [])
    var orn = t.ornaments || []
    for (var k = 0; k < orn.length; k++) {
      var o = orn[k]
      var p = ornamentPoint(w, h, o.u, o.v)
      if (o.kind === "bauble") bauble(ctx, p.x, p.y, w * 0.046, o.color || "#e74c3c", k, o.style)
      else if (o.kind === "candy") candyCane(ctx, p.x, p.y, w, k)
      else if (o.kind === "light") socket(ctx, p.x, p.y, w, k)
    }
    if (t.star) star(ctx, cx, g.top, w * 0.1)
  }
  ctx.restore()
}

// Needle tufts: short strokes fanning out and down from the middle of each
// bough, in five shades, brighter on the lit side and at the tips.
function needles(ctx, g, tier, rnd, index) {
  var cx = g.cx
  var count = 70 + index * 26
  var groups = [[], [], [], [], []]
  for (var n = 0; n < count; n++) {
    var fy = Math.sqrt(rnd())
    var y = tier.y0 + (tier.y1 - tier.y0) * (0.12 + 0.88 * fy)
    var halfAt = tier.halfTop * 0.5 + (tier.half - tier.halfTop * 0.5) * fy
    var u = rnd() * 2 - 1
    var x = cx + u * halfAt * 0.96
    var side = u < 0 ? -1 : 1
    var len = 2.4 + rnd() * 3.6
    var lit = (1 - (u + 1) / 2) * 0.7 + fy * 0.15 + Math.abs(u) * 0.35 + rnd() * 0.25
    var s = lit > 0.95 ? 0 : (lit > 0.72 ? 1 : (lit > 0.5 ? 2 : (lit > 0.3 ? 3 : 4)))
    var ang = Math.PI / 2 - side * (0.6 + rnd() * 0.5)
    groups[s].push([x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len])
  }
  ctx.lineCap = "round"
  for (var k = 4; k >= 0; k--) {
    var list = groups[k]
    if (!list.length) continue
    ctx.strokeStyle = TREE.needles[k]
    ctx.lineWidth = k === 0 ? 0.7 : 0.85
    ctx.beginPath()
    for (var j = 0; j < list.length; j++) { var l = list[j]; ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]) }
    ctx.stroke()
  }
  ctx.lineCap = "butt"
}

// Snow lying on the boughs: soft lumps along the upper face of the hem,
// white on top, blue in their own shadow, with gaps where it fell off.
function boughSnow(ctx, g, tier, rnd) {
  var cx = g.cx
  var n = tier.tips
  var droop = (tier.y1 - tier.y0) * 0.1
  var rise = (tier.y1 - tier.y0) * 0.2
  var strips = []
  for (var k = 0; k < n; k++) {
    if (rnd() < 0.22) continue
    var xa = cx - tier.half + (2 * tier.half) * k / n
    var xb = cx - tier.half + (2 * tier.half) * (k + 1) / n
    var mid = (xa + xb) / 2
    var tipY = tier.y1 + droop * (0.4 + 0.6 * Math.abs(mid - cx) / tier.half)
    var from = 0.12 + rnd() * 0.15, to = 0.72 + rnd() * 0.2
    // A flat lens of snow resting on the bough's back, thickest in the
    // middle, sloping a little toward the drooping tip.
    var x0 = xa + (xb - xa) * from, x1 = xa + (xb - xa) * to
    var outward = mid < cx ? -1 : 1
    var yIn = tier.y1 - rise * 0.75, yOut = tipY - rise * 0.6
    var y0 = outward < 0 ? yOut : yIn, y1 = outward < 0 ? yIn : yOut
    strips.push([x0, y0, x1, y1, 1.6 + rnd() * 1.4])
  }
  var lens = function(st, dy) {
    var mx = (st[0] + st[2]) / 2, my = (st[1] + st[3]) / 2
    ctx.moveTo(st[0], st[1] + dy)
    ctx.quadraticCurveTo(mx, my - st[4] * 1.6 + dy, st[2], st[3] + dy)
    ctx.quadraticCurveTo(mx, my + st[4] * 0.5 + dy, st[0], st[1] + dy)
  }
  ctx.fillStyle = "rgba(130,160,210,0.6)"
  ctx.beginPath()
  for (var i = 0; i < strips.length; i++) lens(strips[i], 1)
  ctx.fill()
  ctx.fillStyle = "rgba(250,252,255,0.97)"
  ctx.beginPath()
  for (var j = 0; j < strips.length; j++) lens(strips[j], 0)
  ctx.fill()
}

function ellipsePath(ctx, x, y, rx, ry) {
  ctx.moveTo(x + rx, y)
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.restore()
}

// A glass bauble: a coloured sphere lit from the upper left, darker at its
// rim, with a sharp highlight, the soft reflection of a window, a green
// bounce from the needles, a gold cap and its hook, and a contact shadow.
function bauble(ctx, x, y, r, hex, k, style) {
  if (style && style !== "glass") return baubleStyled(ctx, x, y, r, hex, k, style)
  var c = rgbOf(hex)
  ctx.fillStyle = "rgba(0,18,8,0.4)"
  ctx.beginPath(); ellipsePath(ctx, x + r * 0.35, y + r * 0.55, r * 1.05, r * 0.95); ctx.fill()
  // Hook.
  ctx.strokeStyle = "rgba(210,200,160,0.8)"
  ctx.lineWidth = 0.6
  ctx.beginPath(); ctx.moveTo(x, y - r * 1.15); ctx.quadraticCurveTo(x + r * 0.35, y - r * 1.7, x - r * 0.05, y - r * 1.9); ctx.stroke()
  var g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.05)
  g.addColorStop(0, rgba(shade(c, 0.55)))
  g.addColorStop(0.3, rgba(shade(c, 0.08)))
  g.addColorStop(0.78, rgba(shade(c, -0.42)))
  g.addColorStop(1, rgba(shade(c, -0.62)))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  // Bounce light from the needles along the lower rim.
  ctx.strokeStyle = "rgba(90,190,110,0.35)"
  ctx.lineWidth = r * 0.16
  ctx.beginPath(); ctx.arc(x, y, r * 0.88, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke()
  // Window reflection: a soft curved bar.
  ctx.strokeStyle = "rgba(255,255,255,0.28)"
  ctx.lineWidth = r * 0.18
  ctx.beginPath(); ctx.arc(x, y, r * 0.66, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke()
  // Specular highlight.
  ctx.fillStyle = "rgba(255,255,255,0.92)"
  ctx.beginPath(); ellipsePath(ctx, x - r * 0.38, y - r * 0.44, r * 0.2, r * 0.13); ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,0.5)"
  ctx.beginPath(); ctx.arc(x + r * 0.42, y + r * 0.38, r * 0.07, 0, Math.PI * 2); ctx.fill()
  // Cap.
  var cap = ctx.createLinearGradient(x - r * 0.28, 0, x + r * 0.28, 0)
  cap.addColorStop(0, "#fff0b0"); cap.addColorStop(0.45, "#d6ac3c"); cap.addColorStop(1, "#7d5c14")
  ctx.fillStyle = cap
  ctx.fillRect(x - r * 0.28, y - r * 1.17, r * 0.56, r * 0.3)
  ctx.strokeStyle = "rgba(90,60,10,0.6)"
  ctx.lineWidth = 0.4
  ctx.beginPath()
  for (var i = 1; i < 4; i++) { ctx.moveTo(x - r * 0.28 + i * r * 0.14, y - r * 1.17); ctx.lineTo(x - r * 0.28 + i * r * 0.14, y - r * 0.87) }
  ctx.stroke()
}

// A candy cane: a shaded white crook with spiral red stripes.
function candyCane(ctx, x, y, w, k) {
  var s = w * 0.011
  var len = w * 0.075
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(((k * 37) % 7 - 3) * 0.05)
  var path = function() {
    ctx.beginPath()
    ctx.moveTo(0, len)
    ctx.lineTo(0, 0)
    ctx.arc(s * 2.3, 0, s * 2.3, Math.PI, 0)
    ctx.lineTo(s * 4.6, s * 1.6)
  }
  ctx.lineCap = "round"
  ctx.strokeStyle = "rgba(0,18,8,0.38)"
  ctx.lineWidth = s * 2.4
  ctx.save(); ctx.translate(s * 0.8, s * 1.0); path(); ctx.stroke(); ctx.restore()
  ctx.strokeStyle = "#e8e6ec"
  ctx.lineWidth = s * 2.2
  path(); ctx.stroke()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = s * 1.2
  ctx.save(); ctx.translate(-s * 0.3, 0); path(); ctx.stroke(); ctx.restore()
  // Stripes.
  ctx.strokeStyle = "#d7212f"
  ctx.lineWidth = s * 0.8
  ctx.lineCap = "butt"
  ctx.beginPath()
  for (var i = 0; i < 4; i++) {
    var yy = len - s * 1.5 - i * s * 2.6
    ctx.moveTo(-s * 1.1, yy + s * 0.9); ctx.lineTo(s * 1.1, yy - s * 0.9)
  }
  for (var j = 0; j < 4; j++) {
    var a = Math.PI + (j + 0.5) * Math.PI / 4
    var cxx = s * 2.3 + Math.cos(a) * s * 2.3, cyy = Math.sin(a) * s * 2.3
    ctx.moveTo(cxx - Math.cos(a) * s * 1.1, cyy - Math.sin(a) * s * 1.1)
    ctx.lineTo(cxx + Math.cos(a) * s * 1.1, cyy + Math.sin(a) * s * 1.1)
  }
  ctx.stroke()
  ctx.restore()
}

// The socket a tree bulb sits in; the bulb itself is in treeLights.
function socket(ctx, x, y, w, k) {
  var a = bulbTilt(k)
  ctx.save()
  ctx.translate(x, y); ctx.rotate(a)
  ctx.fillStyle = "#123a1e"
  ctx.fillRect(-w * 0.009, -w * 0.016, w * 0.018, w * 0.018)
  ctx.restore()
}

function bulbTilt(k) { return ((k * 53) % 11 - 5) * 0.09 }

function lightWire(ctx, w, h, orn) {
  var pts = []
  for (var i = 0; i < orn.length; i++) if (orn[i].kind === "light") pts.push(ornamentPoint(w, h, orn[i].u, orn[i].v))
  if (pts.length < 2) return
  ctx.strokeStyle = "rgba(14,40,20,0.95)"
  ctx.lineWidth = 0.9
  ctx.beginPath()
  for (var j = 0; j + 1 < pts.length; j++) {
    var a = pts[j], b = pts[j + 1]
    var d = Math.hypot(b.x - a.x, b.y - a.y)
    if (d > w * 0.55) continue
    ctx.moveTo(a.x, a.y - w * 0.012)
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + d * 0.16, b.x, b.y - w * 0.012)
  }
  ctx.stroke()
}

// The star topper: five points, each split into a lit and a shaded facet,
// in polished gold with a bright centre and a fine dark edge.
function star(ctx, x, y, r) {
  var pts = []
  for (var i = 0; i < 10; i++) {
    var a = -Math.PI / 2 + i * Math.PI / 5
    var rr = i % 2 ? r * 0.42 : r
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr])
  }
  // Facets: from the centre to each tip and its two inner corners.
  for (var k = 0; k < 10; k++) {
    var p = pts[k], q = pts[(k + 1) % 10]
    var mx = (p[0] + q[0]) / 2 - x, my = (p[1] + q[1]) / 2 - y
    // Lit when the facet faces the upper left.
    var lit = (-mx * 0.7 - my * 0.7) / (Math.hypot(mx, my) || 1)
    var t = 0.5 + 0.5 * lit
    var col = t > 0.5 ? shade([240, 190, 50], (t - 0.5) * 1.2) : shade([240, 190, 50], -(0.5 - t) * 0.9)
    var g = ctx.createLinearGradient(x, y, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
    g.addColorStop(0, rgba(shade(col, 0.45)))
    g.addColorStop(1, rgba(col))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill()
  }
  ctx.strokeStyle = "rgba(120,80,0,0.7)"
  ctx.lineWidth = 0.6
  ctx.beginPath()
  for (var j = 0; j < 10; j++) { if (j === 0) ctx.moveTo(pts[j][0], pts[j][1]); else ctx.lineTo(pts[j][0], pts[j][1]) }
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = "rgba(255,252,230,0.95)"
  ctx.beginPath(); ctx.arc(x - r * 0.06, y - r * 0.06, r * 0.1, 0, Math.PI * 2); ctx.fill()
}

// ------------------------------------------------------------- light

// A bulb's brightness at `time`: two slow waves out of step, so each bulb
// breathes on its own and none blinks hard, like warm filaments.
function twinkle(time, phase, freq) {
  var a = Math.sin(time * freq * 1.9 + phase)
  var b = Math.sin(time * freq * 0.71 + phase * 2.3)
  var c = Math.sin(time * 0.37 + phase * 0.5)
  return clamp01(0.72 + 0.17 * a + 0.09 * b + 0.06 * c)
}
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v) }

// One bulb hanging from (x, y) at angle `theta` from straight down, `len`
// long: a glass teardrop whose filament glows white-hot at full brightness
// and sinks into its colour as it dims, a highlight on the glass, and a
// bloom around it. Paint with globalCompositeOperation "source-over".
function bulb(ctx, x, y, theta, len, rgb, bright) {
  var wid = len * 0.42
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-theta)
  // Socket.
  var sg = ctx.createLinearGradient(-wid * 0.45, 0, wid * 0.45, 0)
  sg.addColorStop(0, "#2a5a34"); sg.addColorStop(1, "#0b2612")
  ctx.fillStyle = sg
  ctx.fillRect(-wid * 0.42, 0, wid * 0.84, len * 0.32)
  // Glass.
  var cy = len * 0.32
  ctx.beginPath()
  ctx.moveTo(-wid * 0.42, cy)
  ctx.bezierCurveTo(-wid * 0.62, cy + len * 0.18, -wid * 0.5, cy + len * 0.5, 0, cy + len * 0.68)
  ctx.bezierCurveTo(wid * 0.5, cy + len * 0.5, wid * 0.62, cy + len * 0.18, wid * 0.42, cy)
  ctx.closePath()
  var fy = cy + len * 0.32
  var g = ctx.createRadialGradient(0, fy, len * 0.02, 0, fy, len * 0.5)
  var hot = shade(rgb, 0.85 * bright)
  g.addColorStop(0, rgba(hot, 1))
  g.addColorStop(0.35, rgba(shade(rgb, 0.25 * bright), 0.98))
  g.addColorStop(1, rgba(shade(rgb, -0.45 + 0.3 * bright), 0.95))
  ctx.fillStyle = g
  ctx.fill()
  // Highlight down the glass.
  ctx.strokeStyle = "rgba(255,255,255," + (0.35 + 0.25 * (1 - bright)).toFixed(2) + ")"
  ctx.lineWidth = wid * 0.16
  ctx.beginPath(); ctx.moveTo(-wid * 0.22, cy + len * 0.08); ctx.quadraticCurveTo(-wid * 0.34, cy + len * 0.28, -wid * 0.12, cy + len * 0.5); ctx.stroke()
  ctx.restore()
}

// Additive light: a soft disc of colour, brightest in the middle.
function glow(ctx, x, y, r, rgb, a) {
  if (a <= 0.004 || r <= 0.5) return
  var g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(rgb, a))
  g.addColorStop(0.35, rgba(rgb, a * 0.45))
  g.addColorStop(1, rgba(rgb, 0))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}

// A bulb's bloom in one gradient: a white-hot centre fading through its
// colour into the dark.
function bloom(ctx, x, y, r, rgb, b) {
  var g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, rgba(shade(rgb, 0.8), 0.9 * b * b))
  g.addColorStop(0.2, rgba(rgb, 0.55 * b))
  g.addColorStop(0.5, rgba(rgb, 0.2 * b))
  g.addColorStop(1, rgba(rgb, 0))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}

// The tree's moving light, painted over `tree` on its own layer.
function treeLights(ctx, w, h, t, time) {
  if ((t.growth === undefined ? 1 : t.growth) < 1) return
  var g = treeGeometry(w, h)
  var orn = t.ornaments || []
  var lights = [], baubles = []
  for (var i = 0; i < orn.length; i++) {
    var o = orn[i]
    var p = ornamentPoint(w, h, o.u, o.v)
    if (o.kind === "light") {
      var rgb = rgbOf(o.color || "#ffd84d")
      lights.push({ x: p.x, y: p.y, rgb: rgb, b: twinkle(time, i * 2.39, 0.55 + ((i * 7) % 5) * 0.12), k: i })
    } else if (o.kind === "bauble") baubles.push({ x: p.x, y: p.y, k: i })
  }
  var starOn = !!t.star
  var starB = 0.9 + 0.1 * Math.sin(time * 1.3)

  ctx.globalCompositeOperation = "lighter"
  // Light falling on the needles around each bulb.
  for (var a = 0; a < lights.length; a++) {
    var L = lights[a]
    glow(ctx, L.x, L.y + w * 0.012, w * 0.2, L.rgb, 0.22 * L.b)
  }
  if (starOn) glow(ctx, g.cx, g.top + w * 0.12, w * 0.3, [255, 205, 110], 0.1 * starB)
  // Each bauble mirrors the bulbs near it: a small coloured glint on the
  // side facing the light, stronger the closer it is.
  var br = w * 0.046
  for (var j = 0; j < baubles.length; j++) {
    var B = baubles[j]
    for (var k = 0; k < lights.length; k++) {
      var Lk = lights[k]
      var dx = Lk.x - B.x, dy = Lk.y - B.y
      var d = Math.hypot(dx, dy)
      var reach = w * 0.32
      if (d > reach || d < 1) continue
      var f = (1 - d / reach)
      glow(ctx, B.x + dx / d * br * 0.55, B.y + dy / d * br * 0.55, br * 0.5, shade(Lk.rgb, 0.3), 0.9 * f * f * Lk.b)
    }
    if (starOn) {
      var sd = Math.hypot(g.cx - B.x, g.top - B.y)
      if (sd < w * 0.6) glow(ctx, B.x + (g.cx - B.x) / sd * br * 0.6, B.y + (g.top - B.y) / sd * br * 0.6, br * 0.4, [255, 230, 160], 0.5 * (1 - sd / (w * 0.6)))
    }
  }
  ctx.globalCompositeOperation = "source-over"
  // The bulbs themselves.
  for (var m = 0; m < lights.length; m++) {
    var Lm = lights[m]
    bulb(ctx, Lm.x, Lm.y - w * 0.014, bulbTilt(Lm.k), w * 0.055, Lm.rgb, Lm.b)
  }
  ctx.globalCompositeOperation = "lighter"
  for (var n = 0; n < lights.length; n++) {
    var Ln = lights[n]
    var cxl = Ln.x + Math.sin(bulbTilt(Ln.k)) * w * 0.03, cyl = Ln.y + w * 0.014
    bloom(ctx, cxl, cyl, w * 0.055, Ln.rgb, Ln.b)
  }
  // The star: a warm halo, a bright core, and faint rays turning slowly.
  if (starOn) {
    var sx = g.cx, sy = g.top
    glow(ctx, sx, sy, w * 0.38, [255, 196, 90], 0.22 * starB)
    glow(ctx, sx, sy, w * 0.14, [255, 230, 160], 0.45 * starB)
    var rot = time * 0.08
    for (var r = 0; r < 4; r++) {
      var ang = rot + r * Math.PI / 4
      var len = w * (r % 2 ? 0.2 : 0.3) * starB
      var rg = ctx.createLinearGradient(sx - Math.cos(ang) * len, sy - Math.sin(ang) * len, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len)
      rg.addColorStop(0, "rgba(255,235,180,0)")
      rg.addColorStop(0.5, "rgba(255,240,200," + (0.45 * starB).toFixed(3) + ")")
      rg.addColorStop(1, "rgba(255,235,180,0)")
      ctx.strokeStyle = rg
      ctx.lineWidth = r % 2 ? 0.7 : 1.1
      ctx.beginPath(); ctx.moveTo(sx - Math.cos(ang) * len, sy - Math.sin(ang) * len); ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); ctx.stroke()
    }
    glow(ctx, sx - w * 0.006, sy - w * 0.006, w * 0.03, [255, 255, 245], 0.7 * starB)
  }
  ctx.globalCompositeOperation = "source-over"
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



// ------------------------------------------------------------------ the plow
//
// A yellow crawler dozer, drawn in its own frame: x forward from the
// blade's cutting edge, y up from the ground, in px at a 1080 px screen.
// The bottom run of each track stays put on the ground while the top run
// moves forward at twice the dozer's speed, so the grousers are animated
// around the belt by distance travelled, and every wheel turns by it.

var DOZER = {
  yellow: "#ffc414", light: "#ffde66", shade: "#e39d00", deep: "#a86e00",
  line: "rgba(70,45,0,0.55)",
  steel: "#2b2e34", steelMid: "#3d414a", steelLight: "#5d636e", chrome: "#dfe4ea"
}

function drawPlow(ctx, w) {
  var P = w.plow
  var gy = w.height - w.groundInset
  var k = P.k
  ctx.save()
  ctx.translate(P.x, gy + P.bob)
  ctx.scale(P.dir * k, k)
  // Shadow on the snow.
  ctx.fillStyle = "rgba(10,14,24,0.28)"
  ctx.beginPath(); ellipse(ctx, -84, 0.5, 86, 3.2); ctx.fill()
  // Pitch about the rear of the tracks.
  ctx.translate(-142, 0); ctx.rotate(P.pitch); ctx.translate(142, 0)
  dozerBody(ctx, P, w.time)
  ctx.restore()

  drawBerm(ctx, P, gy, w.time)
  var roof = w.surfaces["__plow"]
  if (roof) drawCap(ctx, roof)
}

function dozerBody(ctx, P, time) {
  var C = DOZER
  var tread = P.tread / P.k
  var lift = P.lift * 34 * 0.9

  // Ripper at the back.
  ctx.lineCap = "round"
  ctx.strokeStyle = C.steelMid
  ctx.lineWidth = 3.4
  ctx.beginPath(); ctx.moveTo(-144, -30); ctx.lineTo(-158, -27); ctx.stroke()
  ctx.strokeStyle = C.steel
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(-156, -28); ctx.quadraticCurveTo(-160, -14, -153, -4); ctx.stroke()
  ctx.fillStyle = C.steelLight
  ctx.beginPath(); ctx.moveTo(-155, -6); ctx.lineTo(-149, -1.5); ctx.lineTo(-153.5, -0.5); ctx.closePath(); ctx.fill()

  // C-frame push arm, from the track frame to the blade.
  ctx.lineCap = "butt"
  ctx.strokeStyle = C.deep
  ctx.lineWidth = 6.5
  ctx.beginPath(); ctx.moveTo(-72, -14); ctx.lineTo(-6, -9 - lift * 0.9); ctx.stroke()
  ctx.strokeStyle = C.shade
  ctx.lineWidth = 3.5
  ctx.beginPath(); ctx.moveTo(-72, -15.2); ctx.lineTo(-6, -10.2 - lift * 0.9); ctx.stroke()

  drawTrack(ctx, tread)

  // Rear body and counterweight.
  var body = ctx.createLinearGradient(0, -64, 0, -28)
  body.addColorStop(0, C.light); body.addColorStop(0.35, C.yellow); body.addColorStop(1, C.shade)
  ctx.fillStyle = body
  ctx.strokeStyle = C.line
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(-148, -29); ctx.lineTo(-148, -55); ctx.quadraticCurveTo(-148, -62, -141, -62)
  ctx.lineTo(-112, -62); ctx.lineTo(-112, -29); ctx.closePath()
  ctx.fill(); ctx.stroke()

  // Engine hood, sloping down to the grille.
  ctx.beginPath()
  ctx.moveTo(-113, -29); ctx.lineTo(-113, -60); ctx.lineTo(-58, -60)
  ctx.quadraticCurveTo(-47, -59, -42, -52); ctx.lineTo(-37, -44); ctx.lineTo(-37, -29); ctx.closePath()
  ctx.fillStyle = body
  ctx.fill(); ctx.stroke()
  // Top highlight along the hood.
  ctx.strokeStyle = "rgba(255,245,200,0.75)"
  ctx.lineWidth = 1.1
  ctx.beginPath(); ctx.moveTo(-111, -58.8); ctx.lineTo(-59, -58.8); ctx.quadraticCurveTo(-49, -58, -44.5, -52.5); ctx.stroke()
  // Grille.
  ctx.fillStyle = C.steel
  ctx.beginPath(); ctx.moveTo(-41.5, -50); ctx.lineTo(-37.6, -44); ctx.lineTo(-37.6, -31); ctx.lineTo(-41.5, -31); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = C.steelLight
  ctx.lineWidth = 0.6
  ctx.beginPath()
  for (var g = 0; g < 6; g++) { var gy2 = -46 + g * 2.6; ctx.moveTo(-41, gy2); ctx.lineTo(-38, gy2) }
  ctx.stroke()
  // Side louvers and a pinstripe.
  ctx.strokeStyle = "rgba(90,58,0,0.55)"
  ctx.lineWidth = 1.1
  ctx.beginPath()
  for (var l = 0; l < 5; l++) { var lx = -98 + l * 6; ctx.moveTo(lx, -52); ctx.lineTo(lx + 3, -38) }
  ctx.stroke()
  ctx.strokeStyle = "#1c1d21"
  ctx.lineWidth = 1.3
  ctx.beginPath(); ctx.moveTo(-146, -36); ctx.lineTo(-40, -36); ctx.stroke()
  // Snowflake badge on the hood side.
  ctx.save()
  ctx.translate(-62, -46)
  ctx.strokeStyle = "#1c1d21"
  ctx.lineWidth = 1.1
  ctx.beginPath()
  for (var a = 0; a < 3; a++) {
    var an = a * Math.PI / 3
    ctx.moveTo(-Math.cos(an) * 5, -Math.sin(an) * 5); ctx.lineTo(Math.cos(an) * 5, Math.sin(an) * 5)
  }
  ctx.stroke()
  ctx.restore()

  // Fender over the track.
  ctx.fillStyle = C.yellow
  ctx.fillRect(-150, -31, 128, 4)
  ctx.fillStyle = C.deep
  ctx.fillRect(-150, -27.6, 128, 1.4)
  ctx.fillStyle = "rgba(255,240,190,0.7)"
  ctx.fillRect(-150, -31, 128, 0.9)

  // Air pre-cleaner and exhaust stack with its rain cap.
  ctx.fillStyle = C.steelMid
  ctx.fillRect(-84, -67, 6, 7)
  ctx.fillStyle = C.steel
  ctx.beginPath(); ctx.moveTo(-85.5, -67); ctx.lineTo(-76.5, -67); ctx.lineTo(-78, -70); ctx.lineTo(-84, -70); ctx.closePath(); ctx.fill()
  var st = ctx.createLinearGradient(-61, 0, -55, 0)
  st.addColorStop(0, C.steelLight); st.addColorStop(0.5, "#8a909b"); st.addColorStop(1, C.steel)
  ctx.fillStyle = st
  ctx.fillRect(-61, -85, 5.4, 25)
  ctx.fillStyle = "#15161a"
  ctx.fillRect(-61, -86, 5.4, 1.6)
  // The flap lifts with the throttle.
  ctx.save()
  ctx.translate(-55.6, -86)
  ctx.rotate(-(0.2 + P.throttle * 0.9) + Math.sin(time * 31) * 0.05 * P.throttle)
  ctx.fillStyle = C.steelMid
  ctx.fillRect(-6, -1.2, 6.4, 1.4)
  ctx.restore()

  // Lift cylinder: barrel on the hood, chrome rod to the blade.
  var cx0 = -46, cy0 = -51, cx1 = -5, cy1 = -27 - lift
  var mx = cx0 + (cx1 - cx0) * 0.55, my = cy0 + (cy1 - cy0) * 0.55
  ctx.lineCap = "round"
  ctx.strokeStyle = C.chrome
  ctx.lineWidth = 2.2
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(cx1, cy1); ctx.stroke()
  ctx.strokeStyle = C.deep
  ctx.lineWidth = 5
  ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(mx, my); ctx.stroke()
  ctx.strokeStyle = C.shade
  ctx.lineWidth = 2.4
  ctx.beginPath(); ctx.moveTo(cx0, cy0 - 0.8); ctx.lineTo(mx, my - 0.8); ctx.stroke()
  ctx.lineCap = "butt"

  drawCab(ctx, P, time)
  drawBlade(ctx, lift)

  // Headlight on the hood front, and its beam over the snow ahead.
  ctx.fillStyle = C.steel
  ctx.fillRect(-46, -63.5, 5, 4)
  ctx.fillStyle = "#fff6d8"
  ctx.beginPath(); ctx.arc(-41.4, -61.5, 1.8, 0, Math.PI * 2); ctx.fill()
  var halo = ctx.createRadialGradient(-41.4, -61.5, 0.5, -41.4, -61.5, 9)
  halo.addColorStop(0, "rgba(255,240,200,0.45)")
  halo.addColorStop(1, "rgba(255,240,200,0)")
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(-41.4, -61.5, 9, 0, Math.PI * 2); ctx.fill()
}

// The track: a belt around a drive sprocket at the back and an idler at the
// front, road wheels between, grousers moving with the ground.
function drawTrack(ctx, tread) {
  var C = DOZER
  var x0 = -128, x1 = -30, r = 13, cy = -13
  var belt = ctx.createLinearGradient(0, -26, 0, 0)
  belt.addColorStop(0, C.steelLight); belt.addColorStop(0.5, C.steel); belt.addColorStop(1, "#1d1f23")
  ctx.fillStyle = belt
  ctx.beginPath()
  ctx.moveTo(x0, cy - r); ctx.lineTo(x1, cy - r)
  ctx.arc(x1, cy, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x0, cy + r)
  ctx.arc(x0, cy, r, Math.PI / 2, Math.PI * 1.5)
  ctx.closePath()
  ctx.fill()

  // Grousers, spaced evenly around the belt and carried round with it.
  var straight = x1 - x0, arc = Math.PI * r
  var perim = 2 * straight + 2 * arc
  var gap = 6.2
  var off = ((tread % gap) + gap) % gap
  ctx.strokeStyle = "#17181c"
  ctx.lineWidth = 2.6
  ctx.beginPath()
  for (var s = off; s < perim; s += gap) {
    var px, py, nx, ny
    if (s < straight) { px = x0 + s; py = cy - r; nx = 0; ny = -1 }
    else if (s < straight + arc) { var a = -Math.PI / 2 + (s - straight) / r; px = x1 + Math.cos(a) * r; py = cy + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a) }
    else if (s < 2 * straight + arc) { px = x1 - (s - straight - arc); py = cy + r; nx = 0; ny = 1 }
    else { var b = Math.PI / 2 + (s - 2 * straight - arc) / r; px = x0 + Math.cos(b) * r; py = cy + Math.sin(b) * r; nx = Math.cos(b); ny = Math.sin(b) }
    ctx.moveTo(px - nx * 0.6, py - ny * 0.6); ctx.lineTo(px + nx * 1.7, py + ny * 1.7)
  }
  ctx.stroke()

  // Inner face.
  ctx.fillStyle = C.steelMid
  ctx.beginPath()
  ctx.moveTo(x0, cy - r + 4); ctx.lineTo(x1, cy - r + 4)
  ctx.arc(x1, cy, r - 4, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x0, cy + r - 4)
  ctx.arc(x0, cy, r - 4, Math.PI / 2, Math.PI * 1.5)
  ctx.closePath()
  ctx.fill()

  // Track frame.
  ctx.fillStyle = C.shade
  ctx.fillRect(-116, -21, 74, 7)
  ctx.fillStyle = "rgba(255,230,150,0.6)"
  ctx.fillRect(-116, -21, 74, 1)

  // Road wheels, idler, sprocket: all turn by the distance travelled.
  var wheels = [-108, -93, -78, -63, -48]
  for (var i = 0; i < wheels.length; i++) wheel(ctx, wheels[i], -7.5, 5.4, tread / 5.4, 3)
  wheel(ctx, x1, cy, 10, tread / 10, 5)
  // Sprocket: raised, toothed.
  var ang = tread / 11
  ctx.fillStyle = "#24262b"
  ctx.beginPath()
  for (var t = 0; t < 11; t++) {
    var ta = ang + t * Math.PI * 2 / 11
    ctx.moveTo(x0 + Math.cos(ta) * 9, cy - 1 + Math.sin(ta) * 9)
    ctx.arc(x0 + Math.cos(ta) * 11, cy - 1 + Math.sin(ta) * 11, 1.8, 0, Math.PI * 2)
  }
  ctx.fill()
  wheel(ctx, x0, cy - 1, 10, ang, 6)
}

function wheel(ctx, x, y, r, angle, bolts) {
  var C = DOZER
  var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
  g.addColorStop(0, "#8b919c"); g.addColorStop(1, "#3a3e46")
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = C.shade
  ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#2a2c31"
  ctx.beginPath()
  for (var i = 0; i < bolts; i++) {
    var a = angle + i * Math.PI * 2 / bolts
    var bx = x + Math.cos(a) * r * 0.68, by = y + Math.sin(a) * r * 0.68
    ctx.moveTo(bx + r * 0.1, by)
    ctx.arc(bx, by, Math.max(0.5, r * 0.1), 0, Math.PI * 2)
  }
  ctx.fill()
}

// Cab with its roof (ROPS), glass, the driver in an orange hard hat, a
// mirror, and the amber beacon turning on the roof.
function drawCab(ctx, P, time) {
  var C = DOZER
  // Pillars and frame.
  ctx.fillStyle = C.yellow
  ctx.strokeStyle = C.line
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(-139, -62); ctx.lineTo(-137, -96); ctx.lineTo(-90, -96); ctx.lineTo(-84, -62); ctx.closePath()
  ctx.fill(); ctx.stroke()
  // Glass.
  var glass = ctx.createLinearGradient(0, -93, 0, -64)
  glass.addColorStop(0, "#a9d2ee"); glass.addColorStop(0.55, "#5d86ad"); glass.addColorStop(1, "#2e4a68")
  ctx.fillStyle = glass
  ctx.beginPath(); ctx.moveTo(-134.5, -66); ctx.lineTo(-133.3, -92); ctx.lineTo(-116, -92); ctx.lineTo(-116, -66); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(-112, -66); ctx.lineTo(-112, -92); ctx.lineTo(-93, -92); ctx.lineTo(-88.2, -66); ctx.closePath(); ctx.fill()
  // The driver.
  ctx.fillStyle = "#1e242e"
  ctx.beginPath(); ellipse(ctx, -106, -69.5, 6.5, 4.5); ctx.fill()
  ctx.beginPath(); ctx.arc(-104.5, -77.5, 3.6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#ff8a1c"
  ctx.beginPath(); ctx.arc(-104.5, -79.3, 3.9, Math.PI, 0); ctx.fill()
  ctx.fillRect(-109, -79.6, 9.6, 1.1)
  // Control levers.
  ctx.strokeStyle = "#15171b"
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(-99, -66); ctx.lineTo(-97, -72.5); ctx.stroke()
  // Reflections.
  ctx.strokeStyle = "rgba(255,255,255,0.28)"
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(-131, -70); ctx.lineTo(-123, -90)
  ctx.moveTo(-101, -70); ctx.lineTo(-94, -89)
  ctx.stroke()
  // Roof plate.
  var roof = ctx.createLinearGradient(0, -101, 0, -95)
  roof.addColorStop(0, C.light); roof.addColorStop(1, C.shade)
  ctx.fillStyle = roof
  ctx.beginPath(); ctx.moveTo(-142, -95); ctx.lineTo(-141, -99); ctx.lineTo(-86, -99); ctx.lineTo(-84, -95); ctx.closePath()
  ctx.fill(); ctx.stroke()
  // Grab rail and mirror.
  ctx.strokeStyle = "#1c1d21"
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(-86.5, -90); ctx.lineTo(-84, -68); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-87, -93); ctx.lineTo(-80, -95); ctx.stroke()
  ctx.fillStyle = "#1c1d21"
  ctx.fillRect(-81, -99, 2.6, 5)
  // Work light on the roof front.
  ctx.fillStyle = C.steel
  ctx.fillRect(-92, -102, 5, 3)
  ctx.fillStyle = "#fff6d8"
  ctx.fillRect(-87.6, -101.6, 0.9, 2.2)
  // Beacon: a dome with a rotating lamp, its glow sweeping round.
  ctx.fillStyle = "#1c1d21"
  ctx.fillRect(-123, -101, 6, 2)
  var spin = Math.cos(time * 7.5)
  var on = Math.pow(Math.max(0, spin), 3)
  if (on > 0.02) {
    var glow = ctx.createRadialGradient(-120, -104, 1, -120, -104, 26)
    glow.addColorStop(0, "rgba(255,170,40," + (0.55 * on).toFixed(3) + ")")
    glow.addColorStop(1, "rgba(255,170,40,0)")
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(-120, -104, 26, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = on > 0.3 ? "#ffcf5a" : "#e88a10"
  ctx.beginPath(); ctx.arc(-120, -101, 3.3, Math.PI, 0); ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,0.6)"
  ctx.beginPath(); ctx.arc(-121, -102.6, 0.9, 0, Math.PI * 2); ctx.fill()
}

// The blade in profile: a curved moldboard with a steel cutting edge,
// raised by `lift`.
function drawBlade(ctx, lift) {
  var C = DOZER
  var y0 = -lift
  // Brace from the push arm to the blade's top.
  ctx.strokeStyle = C.deep
  ctx.lineWidth = 2.6
  ctx.beginPath(); ctx.moveTo(-22, -13 - lift * 0.8); ctx.lineTo(-5, y0 - 28); ctx.stroke()

  var face = ctx.createLinearGradient(0, y0 - 35, 0, y0)
  face.addColorStop(0, C.light); face.addColorStop(0.45, C.shade); face.addColorStop(1, C.yellow)
  ctx.fillStyle = face
  ctx.strokeStyle = C.line
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(3, y0)
  ctx.quadraticCurveTo(-6.5, y0 - 16, 4, y0 - 35)
  ctx.lineTo(-1, y0 - 36)
  ctx.lineTo(-6, y0 - 33)
  ctx.quadraticCurveTo(-10.5, y0 - 16, -5, y0 - 1)
  ctx.closePath()
  ctx.fill(); ctx.stroke()
  // Spill guard lip.
  ctx.strokeStyle = C.deep
  ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.moveTo(-1, y0 - 36); ctx.lineTo(5, y0 - 36.5); ctx.stroke()
  // Highlight on the curve.
  ctx.strokeStyle = "rgba(255,245,200,0.55)"
  ctx.lineWidth = 0.9
  ctx.beginPath(); ctx.moveTo(1.8, y0 - 4); ctx.quadraticCurveTo(-5.5, y0 - 16, 2.6, y0 - 31); ctx.stroke()
  // Cutting edge and its bolts.
  ctx.fillStyle = "#33363d"
  ctx.beginPath(); ctx.moveTo(-5, y0 - 4); ctx.lineTo(2.6, y0 - 4); ctx.lineTo(4, y0); ctx.lineTo(-5, y0); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = "#c9ced6"
  ctx.lineWidth = 0.6
  ctx.beginPath(); ctx.moveTo(-5, y0 - 0.3); ctx.lineTo(4, y0 - 0.3); ctx.stroke()
  ctx.fillStyle = "#9aa0aa"
  ctx.beginPath()
  ctx.moveTo(-2.2, y0 - 2); ctx.arc(-2.6, y0 - 2, 0.55, 0, Math.PI * 2)
  ctx.moveTo(1.2, y0 - 2); ctx.arc(0.8, y0 - 2, 0.55, 0, Math.PI * 2)
  ctx.fill()
}

// The berm pushed ahead of the blade: snow against the moldboard at its
// angle of repose, lumpy, with the lumps rolling forward as it moves.
function drawBerm(ctx, P, gy, time) {
  if (P.bermH < 0.6) return
  var k = P.k, d = P.dir
  var H = P.bermH, len = P.bermLen
  var x0 = P.x + d * 1.5 * k
  var lift = P.lift * 34 * 0.9 * k
  if (lift > H) return
  var roll = P.tread / k
  // Lumps of snow ride the surface and roll forward a little slower than
  // the berm moves, so they turn over as it advances.
  function lump(u) { return Math.sin(u * 0.29 + roll * 0.11) * 1.3 + Math.sin(u * 0.83 - roll * 0.07 + 1.7) * 0.8 }
  var blade = 34 * k
  ctx.beginPath()
  ctx.moveTo(x0, gy + 1)
  // Up the concave blade face; above the blade's top the heap leans back
  // over it a little.
  var hb = Math.min(H, blade)
  ctx.quadraticCurveTo(x0 - d * 4 * k, gy - hb * 0.5, x0, gy - hb)
  if (H > hb) ctx.quadraticCurveTo(x0 - d * 3 * k, gy - (hb + H) / 2, x0 + d * 2 * k, gy - H)
  var steps = Math.max(3, Math.ceil(len / (4 * k)))
  for (var i = 1; i <= steps; i++) {
    var t = i / steps
    var u = len * t
    // A rounded heap: flat near the blade, steepest on its face.
    var y = gy - H * (1 - Math.pow(t, 1.7))
    var depth = gy - y
    y -= lump(u / k) * k * Math.min(1, depth / (6 * k)) * (1 - t * 0.5)
    ctx.lineTo(x0 + d * u, Math.min(gy + 1, y))
  }
  ctx.lineTo(x0 + d * (len + 3 * k), gy + 1)
  ctx.closePath()
  var g = ctx.createLinearGradient(0, gy - H, 0, gy)
  g.addColorStop(0, "rgba(255,255,255,0.98)")
  g.addColorStop(1, "rgba(206,220,240,0.97)")
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = "rgba(170,195,230,0.55)"
  ctx.lineWidth = 1
  ctx.stroke()
  // The blade's shadow on the snow pressed against it.
  var sh = ctx.createLinearGradient(x0, 0, x0 + d * 9 * k, 0)
  sh.addColorStop(0, "rgba(120,140,175,0.35)")
  sh.addColorStop(1, "rgba(120,140,175,0)")
  ctx.fillStyle = sh
  ctx.fill()
}


// ------------------------------------------------------------------ window lights

var STRING_PALETTES = {
  warm: ["#ffc46b"],
  multi: ["#ff3b30", "#ffb000", "#2ecc71", "#2f7bff", "#c64bff"],
  cool: ["#bfe3ff"],
  candy: ["#ff2d3c", "#fff1e0"]
}

// A light string on a window: first the light it throws on the window and
// on the snow above it, then the wire and its clips, then the bulbs, then
// their bloom. Painted right after its window's cap, so windows in front
// hide it like anything else on this window.
function drawString(ctx, L, s, time) {
  var pts = L.pts
  if (!pts || pts.length < 2) return
  var pal = L.palette === "theme" ? (THEME ? THEME.lights : STRING_PALETTES.multi) : (STRING_PALETTES[L.palette] || STRING_PALETTES.warm)
  var lit = []
  for (var i = 0; i < L.bulbs.length; i++) {
    var b = L.bulbs[i]
    var p = pts[b.i]
    var rgb = rgbOf(pal[b.hue % pal.length])
    var br = twinkle(time, b.phase, b.freq)
    // Where the glass hangs: down the socket's angle.
    var cx = p.x + Math.sin(b.theta) * 9, cy = p.y + Math.cos(b.theta) * 9
    lit.push({ p: p, b: b, rgb: rgb, br: br, cx: cx, cy: cy })
  }
  // Light on the window face, clipped to it, and a little on the snow.
  ctx.save()
  ctx.beginPath(); ctx.rect(s.x, s.y - 30, s.w, s.h + 30); ctx.clip()
  ctx.globalCompositeOperation = "lighter"
  // Neighbouring bulbs light the window together: one pool per pair, in
  // their mixed colour, which looks the same and costs half.
  for (var a = 0; a < lit.length; a += 2) {
    var q = lit[a], q2 = lit[Math.min(a + 1, lit.length - 1)]
    var mixed = [(q.rgb[0] + q2.rgb[0]) / 2, (q.rgb[1] + q2.rgb[1]) / 2, (q.rgb[2] + q2.rgb[2]) / 2]
    glow(ctx, (q.cx + q2.cx) / 2, (q.cy + q2.cy) / 2 + 6, 52, mixed, 0.19 * (q.br + q2.br))
  }
  ctx.globalCompositeOperation = "source-over"
  ctx.restore()

  // Wire: two strands twisted together, a darker body with a faint sheen.
  ctx.lineJoin = "round"
  ctx.strokeStyle = "#0f2a16"
  ctx.lineWidth = 1.7
  wirePath(ctx, pts, 0)
  ctx.stroke()
  ctx.strokeStyle = "rgba(140,190,150,0.35)"
  ctx.lineWidth = 0.6
  wirePath(ctx, pts, -0.5)
  ctx.stroke()
  // Clips on the window's edge.
  var m = 10
  ctx.fillStyle = "#e8edf2"
  for (var c = 0; c < pts.length; c += m) {
    ctx.fillRect(pts[c].x - 1.6, s.y - 1, 3.2, 4.5)
  }
  ctx.fillStyle = "rgba(0,0,0,0.25)"
  for (var c2 = 0; c2 < pts.length; c2 += m) ctx.fillRect(pts[c2].x + 0.6, s.y - 1, 1, 4.5)

  for (var k = 0; k < lit.length; k++) {
    var r = lit[k]
    bulb(ctx, r.p.x, r.p.y, r.b.theta, 14, r.rgb, r.br)
  }
  ctx.globalCompositeOperation = "lighter"
  for (var n = 0; n < lit.length; n++) {
    var t = lit[n]
    bloom(ctx, t.cx, t.cy, 20, t.rgb, t.br)
  }
  ctx.globalCompositeOperation = "source-over"
}

function wirePath(ctx, pts, dy) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y + dy)
  for (var i = 1; i + 1 < pts.length; i++) {
    var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2
    ctx.quadraticCurveTo(pts[i].x, pts[i].y + dy, mx, my + dy)
  }
  var last = pts[pts.length - 1]
  ctx.lineTo(last.x, last.y + dy)
}

// ------------------------------------------------------------------ snowballs
//
// Lit from the upper left like the rest of the scene. A ball is a lumpy
// disc (rounder the more it has rolled) shaded as a sphere: soft white on
// the lit side, cool blue in its core shadow, a little light bounced up
// from the snow under it, and a rim. Its clumps and glints are fixed in the
// ball's own frame, shaded by where they sit on the sphere, so they turn as
// it rolls. Its shadow lies on whatever is under it, softer and fainter the
// higher it is, and where it has sunk in, the snow beside its track hides
// its lower edge.

var BALL_LIGHT = (function() {
  var x = -0.45, y = -0.6, z = 0.66, l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
})()

function drawBalls(ctx, w) {
  var list = w.balls
  if (!list || !list.length) return
  for (var i = 0; i < list.length; i++) ballShadow(ctx, list[i])
  for (var j = 0; j < list.length; j++) {
    ballBody(ctx, list[j], w.time)
    if (list[j].lip) ballLip(ctx, list[j])
  }
}

function ballShadow(ctx, b) {
  var gap = Math.max(0, b.floorY - (b.y + b.r))
  var far = 260 + b.r * 4
  if (gap > far) return
  var t = gap / far
  var rx = b.r * (1.05 + t * 0.7), ry = Math.max(1.5, b.r * (0.2 + t * 0.12))
  var cx = b.x + b.r * 0.18 + gap * 0.12
  ctx.save()
  ctx.translate(cx, b.floorY + 0.5)
  ctx.scale(1, ry / rx)
  var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
  var a = 0.34 * (1 - t) * (1 - t)
  g.addColorStop(0, "rgba(54,70,108," + a.toFixed(3) + ")")
  g.addColorStop(0.55, "rgba(70,88,128," + (a * 0.55).toFixed(3) + ")")
  g.addColorStop(1, "rgba(80,100,140,0)")
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// The ball's outline: a circle with a few slow bumps that turn with it.
function ballPath(ctx, b) {
  var amp = 0.025 + 0.15 * (1 - b.round) + (b.r < 7 ? 0.04 : 0)
  var n = b.r > 30 ? 40 : 28
  var s = b.shape
  ctx.beginPath()
  for (var k = 0; k <= n; k++) {
    var th = k / n * Math.PI * 2
    var u = th - b.angle
    var rr = b.r * (1 + amp * (0.55 * Math.sin(2 * u + s[0]) + 0.3 * Math.sin(3 * u + s[1]) + 0.15 * Math.sin(5 * u + s[2])))
    var x = b.x + Math.cos(th) * rr, y = b.y + Math.sin(th) * rr
    if (k === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function ballBody(ctx, b, time) {
  var r = b.r, x = b.x, y = b.y
  var cool = clamp01((b.pack - 0.5) * 1.6)   // packed snow reads a touch bluer
  ctx.save()
  ballPath(ctx, b)
  var g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.44, r * 0.04, x - r * 0.08, y - r * 0.06, r * 1.12)
  g.addColorStop(0, "#ffffff")
  g.addColorStop(0.3, "#f7fafe")
  g.addColorStop(0.62, cool > 0.5 ? "#dfe8f4" : "#e3ebf6")
  g.addColorStop(0.86, "#bfcde3")
  g.addColorStop(1, "#a7b9d4")
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()

  // Light bounced up from the snow underneath.
  var bounce = ctx.createRadialGradient(x + r * 0.1, y + r * 1.25, r * 0.2, x + r * 0.1, y + r * 1.1, r * 0.95)
  bounce.addColorStop(0, "rgba(240,246,255,0.55)")
  bounce.addColorStop(1, "rgba(240,246,255,0)")
  ctx.fillStyle = bounce
  ctx.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4)

  // Clumps on the face, turning with the ball: each a faint shaded patch,
  // and the newer ones the edge of a layer that wrapped round it.
  var L = BALL_LIGHT
  for (var i = 0; i < b.blobs.length; i++) {
    var c = b.blobs[i]
    var bury = clamp01((c.born / r - 0.72) / 0.28)   // older layers are wrapped over
    if (bury <= 0.02) continue
    var a = c.a + b.angle
    var f = c.f
    var nx = Math.cos(a) * f, ny = Math.sin(a) * f, nz = Math.sqrt(Math.max(0, 1 - f * f))
    var lit = nx * L[0] + ny * L[1] + nz * L[2]
    var px = x + nx * r, py = y + ny * r
    var size = Math.max(1, Math.min(10, c.s * r))
    var radial = size * (0.4 + 0.6 * nz)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(a)
    ctx.beginPath()
    ellipsePath(ctx, size * 0.2, size * 0.25, radial, size)
    ctx.fillStyle = "rgba(120,144,186," + (0.1 * bury * (0.5 + 0.5 * (1 - lit))).toFixed(3) + ")"
    ctx.fill()
    ctx.beginPath()
    ellipsePath(ctx, -size * 0.15, -size * 0.18, radial * 0.8, size * 0.8)
    ctx.fillStyle = "rgba(255,255,255," + (bury * clamp01(0.1 + lit * 0.45)).toFixed(3) + ")"
    ctx.fill()
    if (c.t > 0.35 && f > 0.55) {
      // A seam: the lip of a layer, a short arc round the ball.
      ctx.beginPath()
      ctx.arc(-f * r, 0, f * r, -0.28 - c.t * 0.2, 0.28 + c.t * 0.2)
      ctx.strokeStyle = "rgba(128,152,194," + (0.22 * bury).toFixed(3) + ")"
      ctx.lineWidth = r > 20 ? 1.1 : 0.8
      ctx.stroke()
    }
    ctx.restore()
  }

  // Ice glints where the facets face the light.
  for (var k = 0; k < b.glints.length; k++) {
    var q = b.glints[k]
    var qa = q.a + b.angle
    var gx = Math.cos(qa) * q.f, gy = Math.sin(qa) * q.f, gz = Math.sqrt(Math.max(0, 1 - q.f * q.f))
    var spec = gx * L[0] + gy * L[1] + gz * L[2]
    var s = Math.pow(clamp01(spec), 10) * (0.55 + 0.45 * Math.sin(time * 2.3 + q.ph + b.angle * 3))
    if (s < 0.08) continue
    ctx.globalAlpha = Math.min(1, s * 1.2)
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.arc(x + gx * r, y + gy * r, Math.max(0.6, Math.min(1.6, r * 0.045)), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // A soft core shadow on the side away from the light.
  var core = ctx.createLinearGradient(x - r * 0.6, y - r * 0.75, x + r * 0.75, y + r)
  core.addColorStop(0.45, "rgba(120,145,190,0)")
  core.addColorStop(1, "rgba(98,122,170,0.32)")
  ctx.fillStyle = core
  ctx.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4)
  ctx.restore()

  ballPath(ctx, b)
  ctx.strokeStyle = "rgba(140,165,206,0.55)"
  ctx.lineWidth = r > 14 ? 1.1 : 0.8
  ctx.stroke()
}

// Snow beside the track, in front of the ball's lower edge: a soft mound
// banked against it, feathered into the snow at both ends.
function ballLip(ctx, b) {
  var top = b.lip.y, base = b.lip.base + 1
  var dy = top - b.y
  var half = Math.sqrt(Math.max(0, b.r * b.r - dy * dy))
  var span = half * 1.25 + 4
  var x0 = b.x - span, x1 = b.x + span
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x0, base)
  ctx.bezierCurveTo(x0 + span * 0.35, base, b.x - half * 0.75, top, b.x, top - 0.5)
  ctx.bezierCurveTo(b.x + half * 0.75, top, x1 - span * 0.35, base, x1, base)
  ctx.closePath()
  var g = ctx.createLinearGradient(0, top, 0, base)
  g.addColorStop(0, "rgba(255,255,255,0.98)")
  g.addColorStop(1, "rgba(226,235,248,0.97)")
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
  // The crease where the ball sits in it.
  ctx.beginPath()
  ctx.moveTo(b.x - half * 0.7, top + 1.2)
  ctx.quadraticCurveTo(b.x, top - 0.2, b.x + half * 0.7, top + 1.2)
  ctx.strokeStyle = "rgba(120,145,190,0.3)"
  ctx.lineWidth = 1
  ctx.stroke()
}

// ------------------------------------------------------------------ marks in the snow
//
// Writing, pawprints and footprints, in the snow's face. A groove is a soft
// shaded line with a lit lower lip and a faint raised rim above it, lit
// from above like the rest of the snow; a print is a small shaded dimple.
// Strokes are batched by how filled-in they are.

function drawMarks(ctx, s) {
  var list = s.marks
  var shadow = THEME ? rgbOf(THEME.shadow) : [196, 212, 236]
  var deep = shade(shadow, -0.38)
  var levels = [0.33, 0.66, 1.01]
  for (var L = 0; L < 3; L++) {
    var lo = L === 0 ? 0 : levels[L - 1], hi = levels[L]
    var a = (lo + hi) / 2
    var grooves = [], prints = [], feet = [], hind = []
    for (var i = 0; i < list.length; i++) {
      var m = list[i]
      if (m.a < lo || m.a >= hi) continue
      if (m.t === 0) grooves.push(i)
      else if (m.t === 1) prints.push(m)
      else if (m.t === 3) hind.push(m)
      else feet.push(m)
    }
    if (grooves.length) {
      // The shaded groove, and the lit lip below it (the rim pushed up).
      strokeMarks(ctx, s, list, grooves, 0, rgba(deep, 0.6 * a), 1.7)
      strokeMarks(ctx, s, list, grooves, 1.15, "rgba(255,255,255," + (0.85 * a).toFixed(3) + ")", 0.9)
    }
    if (prints.length) {
      ctx.beginPath()
      for (var p = 0; p < prints.length; p++) ellipsePath(ctx, s.x + prints[p].x, s.y - prints[p].h, 1.7, 0.85)
      ctx.fillStyle = rgba(deep, 0.42 * a)
      ctx.fill()
      ctx.beginPath()
      for (var q = 0; q < prints.length; q++) ellipsePath(ctx, s.x + prints[q].x + 0.3, s.y - prints[q].h + 0.9, 1.5, 0.4)
      ctx.fillStyle = "rgba(255,255,255," + (0.75 * a).toFixed(3) + ")"
      ctx.fill()
    }
    if (hind.length) {
      // A hare's hind prints: long, the heel end narrower.
      ctx.beginPath()
      for (var hi = 0; hi < hind.length; hi++) ellipsePath(ctx, s.x + hind[hi].x, s.y - hind[hi].h, 3.1, 0.95)
      ctx.fillStyle = rgba(deep, 0.45 * a)
      ctx.fill()
      ctx.beginPath()
      for (var hj = 0; hj < hind.length; hj++) ellipsePath(ctx, s.x + hind[hj].x + 0.3, s.y - hind[hj].h + 1, 2.8, 0.42)
      ctx.fillStyle = "rgba(255,255,255," + (0.75 * a).toFixed(3) + ")"
      ctx.fill()
    }
    if (feet.length) {
      ctx.beginPath()
      for (var f = 0; f < feet.length; f++) {
        var fx = s.x + feet[f].x, fy = s.y - feet[f].h
        ctx.moveTo(fx + 0.8, fy); ctx.arc(fx, fy, 0.8, 0, Math.PI * 2)
      }
      ctx.fillStyle = rgba(deep, 0.55 * a)
      ctx.fill()
    }
  }
}

function strokeMarks(ctx, s, list, idx, dy, color, width) {
  ctx.beginPath()
  var prev = null
  for (var i = 0; i < idx.length; i++) {
    var m = list[idx[i]]
    var x = s.x + m.x, y = s.y - m.h + dy
    if (prev && prev.k === m.k && idx[i] === prev.i + 1 && Math.abs(prev.x - x) + Math.abs(prev.y - y) < 6) ctx.lineTo(x, y)
    else { ctx.moveTo(x - 0.01, y); ctx.lineTo(x, y) }
    prev = { k: m.k, i: idx[i], x: x, y: y }
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.lineJoin = "bevel"
  ctx.stroke()
}

// Glints in glazed snow: a few fixed points per surface catch the light in
// turn, each a tiny cross that brightens and fades.
function drawGlints(ctx, s, cell, glaze, time) {
  var b = s.bins, n = b.length
  var seed = hashString(String(s.id))
  ctx.beginPath()
  var any = false
  for (var i = 0; i < n; i++) {
    var hsh = (Math.imul(i + 1, 2654435761) ^ seed) >>> 0
    if (hsh % 7 !== 0 || b[i] < 0.8) continue
    var tw = Math.sin(time * (0.6 + (hsh % 13) * 0.07) + (hsh % 628) / 100)
    if (tw < 0.55) continue
    var k = (tw - 0.55) / 0.45 * glaze
    var x = s.x + (i + 0.5) * cell, y = s.y - b[i] * ((hsh >> 5) % 10) / 12 - 0.8
    var r = 0.6 + 1.6 * k
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y)
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r)
    any = true
  }
  if (!any) return
  ctx.strokeStyle = "rgba(255,255,255," + (0.75 * glaze).toFixed(3) + ")"
  ctx.lineWidth = 0.7
  ctx.lineCap = "round"
  ctx.stroke()
}

// ------------------------------------------------------------------ icicles
//
// Clear ice hanging from a window's edge. A ridge of ice runs along the
// edge itself, over the window's border, so the icicles grow out of the
// window rather than floating under it, and swells into each one's root.
// Each icicle is a slim, slightly wavy taper (meltwater refreezes in rings)
// with a kinked tip: bright and nearly opaque at the root, clearer toward
// the tip, a soft blue outline so it reads on light wallpapers as well as
// dark, a highlight down its lit (left) side, faint rings across the longer
// ones and a glint at the tip.

function drawFrostLayer(ctx, w, s) { drawFrost(ctx, s, w.time) }
function drawIciclesLayer(ctx, w, s) { drawIcicles(ctx, s, w.border) }

// Half the icicle's width t of the way down (0 root, 1 tip).
function icicleHalf(ic, w, t) {
  return w / 2 * Math.pow(1 - t, 0.85) * (1 + 0.13 * Math.sin(t * 9 + ic.kink * 4))
}
function icicleTipX(ic) { return ic.kink * Math.min(1.2, ic.len * 0.06) }
function icicleWidth(ic) { return ic.w * 1.2 * Math.min(1, 0.45 + ic.len / 12) }

// They hang from the window's bottom edge, from the outer edge of the
// border the compositor draws around it (`border`, px), or from its top
// edge under the snow when there is no room below it (s.iceAt, see
// iceAnchor in sim.js).
function drawIcicles(ctx, s, border) {
  var list = s.icicles
  var top = s.iceAt === "top"
  var b = top ? 0 : Math.max(0, Number(border) || 0)
  var edge = top ? s.y : s.y + s.h           // where the ridge starts: the content's edge
  var y0 = top ? s.y + 0.5 : s.y + s.h + b   // where the icicles hang from
  var live = [], longest = 0
  for (var i = 0; i < list.length; i++) if (list[i].len > 0.6) { live.push(list[i]); longest = Math.max(longest, list[i].len) }
  if (!live.length) return
  live.sort(function(p, q) { return p.ox - q.ox })
  var N = 6

  // The ridge along the edge: a band of ice over the border, thicker where
  // the ice is long, swelling into each root.
  var th = 1.2 + Math.min(2.2, longest * 0.08)
  var xa = s.x + Math.max(0, live[0].ox - icicleWidth(live[0]) * 1.6 - 3)
  var xb = s.x + Math.min(s.w, live[live.length - 1].ox + icicleWidth(live[live.length - 1]) * 1.6 + 3)
  ctx.beginPath()
  ctx.moveTo(xa, edge)
  ctx.lineTo(xb, edge)
  ctx.lineTo(xb, y0 + th * 0.3)
  for (var r = live.length - 1; r >= 0; r--) {
    var ic = live[r], x = s.x + ic.ox, w = icicleWidth(ic)
    var dip = y0 + th + Math.min(2, ic.len * 0.08)
    ctx.quadraticCurveTo(x + w * 1.6, y0 + th * 0.55, x + w * 0.7, dip - 0.4)
    ctx.quadraticCurveTo(x, dip + 0.3, x - w * 0.7, dip - 0.4)
    var nx = r > 0 ? s.x + live[r - 1].ox : xa
    ctx.quadraticCurveTo((x - w + nx) / 2, y0 + th * 0.45, Math.max(xa, (x - w * 1.6 + nx) / 2), y0 + th * 0.5)
  }
  ctx.lineTo(xa, y0 + th * 0.3)
  ctx.closePath()
  var rg = ctx.createLinearGradient(0, edge, 0, y0 + th + 2)
  rg.addColorStop(0, "rgba(250,253,255,0.96)")
  rg.addColorStop(1, "rgba(206,228,252,0.86)")
  ctx.fillStyle = rg
  ctx.fill()

  // The icicles, one path.
  ctx.beginPath()
  for (var j = 0; j < live.length; j++) {
    var c = live[j], cx0 = s.x + c.ox, cw = icicleWidth(c), L = c.len, tx = icicleTipX(c)
    var ys = y0 + th * 0.4                    // they start inside the ridge
    ctx.moveTo(cx0 - icicleHalf(c, cw, 0), ys)
    for (var k = 1; k <= N; k++) {
      var t = k / N
      ctx.lineTo(cx0 + tx * t * t - icicleHalf(c, cw, t), ys + L * t)
    }
    for (var k2 = N - 1; k2 >= 0; k2--) {
      var t2 = k2 / N
      ctx.lineTo(cx0 + tx * t2 * t2 + icicleHalf(c, cw, t2), ys + L * t2)
    }
    ctx.closePath()
  }
  var g = ctx.createLinearGradient(0, y0, 0, y0 + th + longest)
  g.addColorStop(0, "rgba(244,250,255,0.95)")
  g.addColorStop(0.45, "rgba(204,228,252,0.8)")
  g.addColorStop(1, "rgba(172,210,248,0.42)")
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = "rgba(92,136,190,0.5)"
  ctx.lineWidth = 0.7
  ctx.stroke()

  // The ridge's lower edge, outlined like the icicles, over their roots.
  ctx.beginPath()
  ctx.moveTo(xa, y0 + th * 0.3)
  ctx.lineTo(xb, y0 + th * 0.3)
  ctx.strokeStyle = "rgba(255,255,255,0.55)"
  ctx.lineWidth = 0.6
  ctx.stroke()

  // Highlights down the lit side.
  ctx.beginPath()
  for (var h = 0; h < live.length; h++) {
    var d = live[h]
    if (d.len <= 2) continue
    var hx = s.x + d.ox, hw = icicleWidth(d), hy = y0 + th * 0.4, ht = icicleTipX(d)
    ctx.moveTo(hx - hw * 0.2, hy + 0.6)
    ctx.quadraticCurveTo(hx - hw * 0.26 + ht * 0.1, hy + d.len * 0.4, hx + ht * 0.56 - hw * 0.05, hy + d.len * 0.75)
  }
  ctx.strokeStyle = "rgba(255,255,255,0.88)"
  ctx.lineWidth = 0.8
  ctx.lineCap = "round"
  ctx.stroke()

  // Rings across the longer ones.
  ctx.beginPath()
  for (var q = 0; q < live.length; q++) {
    var e = live[q]
    if (e.len <= 12) continue
    var ex = s.x + e.ox, ew = icicleWidth(e), ey = y0 + th * 0.4, et = icicleTipX(e)
    for (var m = 0; m < 2; m++) {
      var tt = 0.28 + m * 0.24
      var half = icicleHalf(e, ew, tt) * 0.85, ccx = ex + et * tt * tt, yy = ey + e.len * tt
      ctx.moveTo(ccx - half, yy)
      ctx.quadraticCurveTo(ccx, yy + 1.1, ccx + half, yy)
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.42)"
  ctx.lineWidth = 0.5
  ctx.stroke()

  // A glint at each tip.
  ctx.fillStyle = "rgba(255,255,255,0.9)"
  ctx.beginPath()
  for (var z = 0; z < live.length; z++) {
    var f = live[z]
    if (f.len <= 7) continue
    var gx = s.x + f.ox + icicleTipX(f), gy = y0 + th * 0.4 + f.len - 1.6
    ctx.moveTo(gx + 0.8, gy)
    ctx.arc(gx, gy, 0.8, 0, Math.PI * 2)
  }
  ctx.fill()
}

function drawShard(ctx, p) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  ctx.beginPath()
  ctx.moveTo(-p.w / 2, -p.len / 2)
  ctx.lineTo(p.w / 2, -p.len / 2)
  ctx.lineTo(0.2, p.len / 2)
  ctx.closePath()
  ctx.fillStyle = "rgba(220,236,252,0.75)"
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.7)"
  ctx.lineWidth = 0.5
  ctx.beginPath(); ctx.moveTo(-p.w * 0.25, -p.len / 2 + 0.5); ctx.lineTo(0, p.len * 0.3); ctx.stroke()
  ctx.restore()
}

// ------------------------------------------------------------------ fireworks

function drawFireworks(ctx, w) {
  var ps = w.particles
  var rockets = [], embers = [], ticks = [], flashes = []
  for (var i = 0; i < ps.length; i++) {
    var k = ps[i].kind
    if (k === "ember") (ps[i].flash ? flashes : embers).push(ps[i])
    else if (k === "rocket") rockets.push(ps[i])
    else if (k === "tick") ticks.push(ps[i])
  }
  if (!rockets.length && !embers.length && !ticks.length && !flashes.length) return
  var pal = THEME ? THEME.fireworks : FIREWORK_COLORS
  ctx.save()
  ctx.globalCompositeOperation = "lighter"
  ctx.lineCap = "round"
  for (var f = 0; f < flashes.length; f++) {
    var fl = flashes[f]
    var fa = 1 - fl.age / fl.life
    glow(ctx, fl.x, fl.y, fl.r * (1.5 + fl.age * 6), rgbOf(pal[fl.hue % pal.length]), 0.3 * fa * fa)
  }
  if (rockets.length) {
    // A rising shell: a thin, fading thread of sparks behind a bright head.
    for (var r = 0; r < rockets.length; r++) {
      var q = rockets[r]
      var tg = ctx.createLinearGradient(q.x, q.y, q.x - q.vx * 0.09, q.y - q.vy * 0.09)
      tg.addColorStop(0, "rgba(255,240,214,0.7)")
      tg.addColorStop(1, "rgba(255,220,180,0)")
      ctx.strokeStyle = tg
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.09, q.y - q.vy * 0.09); ctx.stroke()
    }
    ctx.beginPath()
    for (var r2 = 0; r2 < rockets.length; r2++) { var h = rockets[r2]; ctx.moveTo(h.x + 1.3, h.y); ctx.arc(h.x, h.y, 1.3, 0, Math.PI * 2) }
    ctx.fillStyle = "rgba(255,246,228,0.95)"
    ctx.fill()
  }
  if (embers.length) {
    // Each ember trails the path it has flown, fine and fading, with a
    // bright head: together they draw the burst's petals curving down.
    // Batched by colour and brightness; they flicker as they burn out.
    for (var c = 0; c < pal.length; c++) {
      var col = rgbOf(pal[c])
      for (var b = 0; b < 3; b++) {
        var trails = [], heads = []
        for (var e = 0; e < embers.length; e++) {
          var p = embers[e]
          if (p.hue % pal.length !== c) continue
          var t = p.age / p.life
          var a = Math.pow(1 - t, 1.3) * (t > 0.5 ? 0.45 + 0.55 * Math.max(0, Math.sin(p.flick + p.age * 21)) : 1)
          if ((a > 0.6 ? 2 : (a > 0.28 ? 1 : 0)) !== b) continue
          trails.push(p); heads.push(p)
        }
        if (!trails.length) continue
        ctx.beginPath()
        for (var q2 = 0; q2 < trails.length; q2++) {
          var tr = trails[q2].tr
          if (!tr || tr.length < 2) continue
          ctx.moveTo(tr[0], tr[1])
          for (var z = 2; z < tr.length; z += 2) ctx.lineTo(tr[z], tr[z + 1])
          ctx.lineTo(trails[q2].x, trails[q2].y)
        }
        ctx.strokeStyle = rgba(col, [0.12, 0.24, 0.38][b])
        ctx.lineWidth = 0.9
        ctx.stroke()
        ctx.beginPath()
        for (var hh = 0; hh < heads.length; hh++) {
          var hp = heads[hh], hr = hp.r * [0.7, 0.9, 1][b]
          ctx.moveTo(hp.x + hr, hp.y); ctx.arc(hp.x, hp.y, hr, 0, Math.PI * 2)
        }
        ctx.fillStyle = rgba(shade(col, 0.35), [0.35, 0.65, 0.95][b])
        ctx.fill()
      }
    }
  }
  for (var tk = 0; tk < ticks.length; tk++) {
    var tc = ticks[tk]
    var ta = Math.sin(Math.min(1, tc.age / tc.life) * Math.PI) * tc.bright
    glow(ctx, tc.x, tc.y, 9, [255, 240, 210], ta * 0.5)
    ctx.fillStyle = "rgba(255,248,232," + ta.toFixed(3) + ")"
    ctx.beginPath(); ctx.arc(tc.x, tc.y, tc.r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

// ------------------------------------------------------------------ spring sprouts

function drawSprouts(ctx, w) {
  var list = w.sprouts
  var g = w.surfaces.__ground
  if (!g) return
  var base = g.y + 1
  var green = rgbOf(THEME ? THEME.sprout : "#86b36e")
  var stems = [], any = false
  ctx.beginPath()
  for (var i = 0; i < list.length; i++) {
    var sp = list[i]
    if (sp.g < 0.03) continue
    any = true
    var h = sp.h * sp.g
    var sway = sp.lean + Math.sin(w.time * 1.1 + sp.phase) * 0.06 + w.wind * 0.003
    var tx = sp.x + sway * h, ty = base - h
    ctx.moveTo(sp.x, base)
    ctx.quadraticCurveTo(sp.x, base - h * 0.6, tx, ty)
    stems.push({ x: tx, y: ty, s: Math.min(1, sp.g * 1.3), n: sp.leaves, sway: sway })
  }
  if (!any) return
  ctx.strokeStyle = rgba(shade(green, -0.25), 0.95)
  ctx.lineWidth = 1
  ctx.lineCap = "round"
  ctx.stroke()
  // Two or three young leaves at the top of each stem.
  ctx.beginPath()
  for (var j = 0; j < stems.length; j++) {
    var st = stems[j]
    var len = 4.6 * st.s
    for (var l = 0; l < st.n; l++) {
      var ang = (l === 0 ? -0.9 : (l === 1 ? 0.9 : 0)) + st.sway - Math.PI / 2
      leafPath(ctx, st.x, st.y, ang, l === 2 ? len * 0.7 : len)
    }
  }
  ctx.fillStyle = rgba(green, 0.95)
  ctx.fill()
}

function leafPath(ctx, x, y, ang, len) {
  var cx = Math.cos(ang), cy = Math.sin(ang)
  var tx = x + cx * len, ty = y + cy * len
  var nx = -cy * len * 0.32, ny = cx * len * 0.32
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo(x + cx * len * 0.5 + nx, y + cy * len * 0.5 + ny, tx, ty)
  ctx.quadraticCurveTo(x + cx * len * 0.5 - nx, y + cy * len * 0.5 - ny, x, y)
}

// ------------------------------------------------------------------ the bird and the cat
//
// Silhouettes, in a deep tone from the theme: the shape and the motion say
// what they are, so there is no detail to fuss over.

function inkColor(a) { return THEME ? rgba(rgbOf(THEME.ink), a) : "rgba(24,28,38," + a + ")" }




// ------------------------------------------------------------------ the golden snowflake

function drawGolden(ctx, F, time) {
  var fade = F.rest && F.restLeft < 3 ? Math.max(0, F.restLeft / 3) : 1
  var pulse = 0.75 + 0.25 * Math.sin(time * 2.2)
  glow(ctx, F.x, F.y, 18, [255, 210, 120], 0.3 * pulse * fade)
  ctx.save()
  ctx.globalAlpha = fade
  ctx.translate(F.x, F.y)
  ctx.rotate(F.spin)
  ctx.strokeStyle = "#f4cd70"
  ctx.lineWidth = 1.1
  ctx.lineCap = "round"
  ctx.beginPath()
  for (var i = 0; i < 6; i++) {
    var a = i * Math.PI / 3
    var cx = Math.cos(a), cy = Math.sin(a)
    ctx.moveTo(0, 0); ctx.lineTo(cx * 6, cy * 6)
    for (var b = -1; b <= 1; b += 2) {
      var bx = cx * 3.4, by = cy * 3.4
      var ba = a + b * Math.PI / 3.2
      ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ba) * 2, by + Math.sin(ba) * 2)
    }
  }
  ctx.stroke()
  ctx.fillStyle = "#fff3cf"
  ctx.beginPath(); ctx.arc(0, 0, 1.1, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

// ------------------------------------------------------------------ bauble finishes
//
// Unlocked by golden snowflakes. Each is a different material lit the same
// way as the glass: frosted (matte, with frost on it), pearl (a soft sheen
// that shifts toward the bauble's colour), gilded (gold leaf with a band
// of colour), mercury glass (antique silvering, mottled).

function baubleStyled(ctx, x, y, r, hex, k, style) {
  var c = rgbOf(hex)
  ctx.fillStyle = "rgba(0,18,8,0.36)"
  ctx.beginPath(); ellipsePath(ctx, x + r * 0.35, y + r * 0.55, r * 1.05, r * 0.95); ctx.fill()
  ctx.strokeStyle = "rgba(210,200,160,0.8)"
  ctx.lineWidth = 0.6
  ctx.beginPath(); ctx.moveTo(x, y - r * 1.15); ctx.quadraticCurveTo(x + r * 0.35, y - r * 1.7, x - r * 0.05, y - r * 1.9); ctx.stroke()
  var g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.05)
  if (style === "frosted") {
    g.addColorStop(0, rgba(shade(c, 0.45))); g.addColorStop(0.6, rgba(shade(c, 0.05))); g.addColorStop(1, rgba(shade(c, -0.35)))
  } else if (style === "pearl") {
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, rgba(shade(c, 0.78))); g.addColorStop(1, rgba(shade(c, 0.25)))
  } else if (style === "gilded") {
    g.addColorStop(0, "#fff2bf"); g.addColorStop(0.35, "#e3b54a"); g.addColorStop(0.8, "#9a6c18"); g.addColorStop(1, "#6b4a0e")
  } else {
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.3, "#d9dde2"); g.addColorStop(0.75, "#8b929c"); g.addColorStop(1, "#4d535c")
  }
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  var rnd = seeded(k * 7919 + 17)
  if (style === "frosted") {
    ctx.fillStyle = "rgba(255,255,255,0.55)"
    ctx.beginPath()
    for (var i = 0; i < 14; i++) {
      var a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.9
      var px = x + Math.cos(a) * d, py = y + Math.sin(a) * d
      ctx.moveTo(px + 0.45, py); ctx.arc(px, py, 0.45, 0, Math.PI * 2)
    }
    ctx.fill()
  } else if (style === "gilded") {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip()
    ctx.fillStyle = rgba(shade(c, -0.1), 0.85)
    ctx.fillRect(x - r, y - r * 0.16, r * 2, r * 0.32)
    ctx.restore()
  } else if (style === "mercury") {
    ctx.fillStyle = "rgba(60,55,45,0.28)"
    ctx.beginPath()
    for (var j = 0; j < 8; j++) {
      var b = rnd() * Math.PI * 2, e = Math.sqrt(rnd()) * r * 0.85
      ellipsePath(ctx, x + Math.cos(b) * e, y + Math.sin(b) * e, r * (0.08 + rnd() * 0.12), r * (0.06 + rnd() * 0.08))
    }
    ctx.fill()
    ctx.strokeStyle = rgba(c, 0.35)
    ctx.lineWidth = r * 0.14
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke()
  }
  // Sheen: soft on the matte finishes, sharp on the polished ones.
  var sharp = style === "gilded" || style === "mercury"
  ctx.fillStyle = sharp ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)"
  ctx.beginPath(); ellipsePath(ctx, x - r * 0.38, y - r * 0.44, r * (sharp ? 0.2 : 0.32), r * (sharp ? 0.13 : 0.22)); ctx.fill()
  var cap = ctx.createLinearGradient(x - r * 0.28, 0, x + r * 0.28, 0)
  cap.addColorStop(0, "#fff0b0"); cap.addColorStop(0.45, "#d6ac3c"); cap.addColorStop(1, "#7d5c14")
  ctx.fillStyle = cap
  ctx.fillRect(x - r * 0.28, y - r * 1.17, r * 0.56, r * 0.3)
}

// ------------------------------------------------------------- shared art helpers
//
// The characters share one light: from the upper left, a cool fill from
// the sky, a warm bounce from below where they stand on snow. Each stands
// on a soft contact shadow.

function contactShadow(ctx, x, y, rx, ry, a) {
  var g = ctx.createRadialGradient(x, y, 0, x, y, rx)
  g.addColorStop(0, "rgba(28,36,64," + a.toFixed(3) + ")")
  g.addColorStop(0.6, "rgba(28,36,64," + (a * 0.45).toFixed(3) + ")")
  g.addColorStop(1, "rgba(28,36,64,0)")
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, ry / rx)
  ctx.translate(-x, -y)
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, rx, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

// A capsule from (ax, ay) radius ra to (bx, by) radius rb: the bodies of
// the cat and the reindeer, so a pose can be interpolated without popping.
function capsulePath(ctx, ax, ay, ra, bx, by, rb) {
  var t = Math.atan2(by - ay, bx - ax)
  ctx.moveTo(ax + Math.cos(t + Math.PI / 2) * ra, ay + Math.sin(t + Math.PI / 2) * ra)
  ctx.arc(ax, ay, ra, t + Math.PI / 2, t + Math.PI * 1.5)
  ctx.arc(bx, by, rb, t - Math.PI / 2, t + Math.PI / 2)
  ctx.closePath()
}

// A limb: a tapered stroke from (ax, ay) through a joint to (cx, cy).
function limb(ctx, ax, ay, jx, jy, cx, cy, w0, w1) {
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.lineWidth = w0
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.stroke()
  ctx.lineWidth = w1
  ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(cx, cy); ctx.stroke()
}

function smoothstep01(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t) }
function lerpN(a, b, t) { return a + (b - a) * t }

// ------------------------------------------------------------- gifts

// A wrapped box: the lid overhangs a little and catches the light, the
// ribbon crosses it with a full bow, a little snow lies on the lid, and it
// sits on a soft shadow. Lit from the upper left.
function gift(ctx, w, h, color) {
  ctx.clearRect(0, 0, w, h)
  var c = rgbOf(color || "#2e86de")
  var rib = [246, 213, 92]
  if (c[0] > 200 && c[1] > 170 && c[2] < 120) rib = [192, 57, 43]
  var bx = w * 0.13, bw = w * 0.74, by = h * 0.42, bh = h * 0.56
  contactShadow(ctx, w * 0.5, h - 1, w * 0.48, h * 0.07, 0.35)
  // The box: front face lit from the left, a darker band at its foot.
  var g = ctx.createLinearGradient(bx, 0, bx + bw, 0)
  g.addColorStop(0, rgba(shade(c, 0.16)))
  g.addColorStop(0.55, rgba(c))
  g.addColorStop(1, rgba(shade(c, -0.28)))
  ctx.fillStyle = g
  ctx.fillRect(bx, by, bw, bh)
  var foot = ctx.createLinearGradient(0, by + bh * 0.7, 0, by + bh)
  foot.addColorStop(0, "rgba(0,0,0,0)"); foot.addColorStop(1, "rgba(0,0,0,0.18)")
  ctx.fillStyle = foot
  ctx.fillRect(bx, by, bw, bh)
  // The lid.
  var lx = w * 0.07, lw = w * 0.86, ly = h * 0.33, lh = h * 0.12
  var lg = ctx.createLinearGradient(0, ly, 0, ly + lh)
  lg.addColorStop(0, rgba(shade(c, 0.26)))
  lg.addColorStop(1, rgba(shade(c, -0.05)))
  ctx.fillStyle = lg
  ctx.fillRect(lx, ly, lw, lh)
  ctx.fillStyle = "rgba(0,0,0,0.22)"
  ctx.fillRect(bx, ly + lh, bw, Math.max(1, h * 0.025))
  // Ribbon: down the front and across the lid, with a sheen.
  var rw = w * 0.13
  var rg = ctx.createLinearGradient(w * 0.5 - rw / 2, 0, w * 0.5 + rw / 2, 0)
  rg.addColorStop(0, rgba(shade(rib, 0.25))); rg.addColorStop(0.5, rgba(rib)); rg.addColorStop(1, rgba(shade(rib, -0.25)))
  ctx.fillStyle = rg
  ctx.fillRect(w * 0.5 - rw / 2, ly, rw, h - ly - 1)
  ctx.fillStyle = rgba(shade(rib, 0.1))
  ctx.fillRect(lx, ly + lh * 0.3, lw, lh * 0.42)
  // The bow: two loops and two tails, the knot in front.
  var kx = w * 0.5, ky = ly + 0.5
  ctx.fillStyle = rgba(shade(rib, -0.12))
  ctx.beginPath()
  ctx.moveTo(kx, ky); ctx.quadraticCurveTo(kx - w * 0.12, ky + h * 0.12, kx - w * 0.2, ky + h * 0.16)
  ctx.lineTo(kx - w * 0.14, ky + h * 0.08); ctx.closePath()
  ctx.moveTo(kx, ky); ctx.quadraticCurveTo(kx + w * 0.12, ky + h * 0.12, kx + w * 0.2, ky + h * 0.15)
  ctx.lineTo(kx + w * 0.15, ky + h * 0.07); ctx.closePath()
  ctx.fill()
  for (var s = -1; s <= 1; s += 2) {
    var lg2 = ctx.createRadialGradient(kx + s * w * 0.13, ky - h * 0.1, 0, kx + s * w * 0.13, ky - h * 0.08, w * 0.2)
    lg2.addColorStop(0, rgba(shade(rib, 0.3))); lg2.addColorStop(1, rgba(shade(rib, -0.2)))
    ctx.fillStyle = lg2
    ctx.beginPath()
    ctx.moveTo(kx, ky)
    ctx.bezierCurveTo(kx + s * w * 0.05, ky - h * 0.22, kx + s * w * 0.3, ky - h * 0.2, kx + s * w * 0.24, ky - h * 0.04)
    ctx.quadraticCurveTo(kx + s * w * 0.14, ky + h * 0.02, kx, ky)
    ctx.fill()
    // The loop's hollow.
    ctx.fillStyle = rgba(shade(rib, -0.45), 0.55)
    ctx.beginPath(); ellipsePath(ctx, kx + s * w * 0.13, ky - h * 0.08, w * 0.05, h * 0.035); ctx.fill()
  }
  ctx.fillStyle = rgba(shade(rib, 0.05))
  ctx.beginPath(); ellipsePath(ctx, kx, ky, w * 0.055, h * 0.045); ctx.fill()
  // A little snow on the lid, to the left of the bow.
  ctx.fillStyle = "rgba(255,255,255,0.95)"
  ctx.beginPath()
  ctx.moveTo(lx, ly + 0.5)
  ctx.quadraticCurveTo(lx + w * 0.05, ly - h * 0.06, lx + w * 0.17, ly - h * 0.03)
  ctx.quadraticCurveTo(lx + w * 0.26, ly - h * 0.05, lx + w * 0.33, ly + 0.5)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,0.9)"
  ctx.beginPath()
  ctx.moveTo(lx + lw * 0.72, ly + 0.5)
  ctx.quadraticCurveTo(lx + lw * 0.84, ly - h * 0.035, lx + lw, ly + 0.5)
  ctx.closePath(); ctx.fill()
  // Lit edge of the lid.
  ctx.fillStyle = "rgba(255,255,255,0.28)"
  ctx.fillRect(lx, ly, lw, Math.max(0.8, h * 0.02))
}

// ------------------------------------------------------------- the snowman

// Three packed balls lit from the upper left: cool blue in their shade, a
// band of shadow where each sits on the one below, a soft skirt of snow
// and a contact shadow at the foot. Coal eyes and buttons catch a glint.
function snowman(ctx, w, h, opts) {
  opts = opts || {}
  ctx.clearRect(0, 0, w, h)
  var cx = w / 2
  var r1 = w * 0.36, r2 = w * 0.265, r3 = w * 0.2
  var y1 = h - r1 * 0.96, y2 = y1 - r1 * 0.82 - r2 * 0.72, y3 = y2 - r2 * 0.86 - r3 * 0.74
  var balls = [[cx, y1, r1, 1.06, 0.94], [cx + w * 0.01, y2, r2, 1.03, 0.97], [cx - w * 0.005, y3, r3, 1, 1]]
  var built = opts.built === undefined ? 1 : opts.built
  contactShadow(ctx, cx + w * 0.04, h - 1.5, w * 0.48, h * 0.035, 0.38 * Math.min(1, built * 3))
  for (var i = 0; i < 3; i++) {
    var grow = smoothstep01(built * 3 - i)
    if (grow <= 0) continue
    var b = balls[i], R = b[2] * grow
    var sx = b[3], sy = b[4]
    var by = i === 0 ? h - R * sy * 0.96 : b[1]
    var g = ctx.createRadialGradient(b[0] - R * 0.38, by - R * 0.42, R * 0.05, b[0] + R * 0.1, by + R * 0.12, R * 1.08)
    g.addColorStop(0, "#ffffff")
    g.addColorStop(0.55, "#f1f5fb")
    g.addColorStop(0.85, "#d4e0f0")
    g.addColorStop(1, "#bccbe2")
    ctx.fillStyle = g
    ctx.beginPath(); ellipsePath(ctx, b[0], by, R * sx, R * sy); ctx.fill()
    // A warm bounce from the snow on the lower rim.
    var bounce = ctx.createLinearGradient(0, by + R * 0.4, 0, by + R * sy)
    bounce.addColorStop(0, "rgba(255,244,230,0)"); bounce.addColorStop(1, "rgba(255,244,230,0.35)")
    ctx.fillStyle = bounce
    ctx.beginPath(); ellipsePath(ctx, b[0], by, R * sx, R * sy); ctx.fill()
    // Where the ball above sits, a soft shadow on this one.
    if (i < 2 && built * 3 - i - 1 > 0) {
      var up = balls[i + 1]
      var so = ctx.createRadialGradient(up[0] + R * 0.06, up[1] + up[2] * 0.95, up[2] * 0.4, up[0] + R * 0.06, up[1] + up[2] * 0.95, up[2] * 1.15)
      so.addColorStop(0, "rgba(90,110,150,0.32)"); so.addColorStop(1, "rgba(90,110,150,0)")
      ctx.save()
      ctx.beginPath(); ellipsePath(ctx, b[0], by, R * sx, R * sy); ctx.clip()
      ctx.fillStyle = so
      ctx.fillRect(b[0] - R * 1.2, by - R * 1.2, R * 2.4, R * 1.4)
      ctx.restore()
    }
  }
  // A skirt of snow heaped round its foot.
  if (built > 0.2) {
    ctx.fillStyle = "rgba(246,249,255,0.96)"
    ctx.beginPath()
    ctx.moveTo(cx - r1 * 1.2, h)
    ctx.quadraticCurveTo(cx - r1 * 0.9, h - r1 * 0.2, cx - r1 * 0.45, h - r1 * 0.12)
    ctx.quadraticCurveTo(cx, h - r1 * 0.2, cx + r1 * 0.5, h - r1 * 0.1)
    ctx.quadraticCurveTo(cx + r1 * 0.95, h - r1 * 0.18, cx + r1 * 1.22, h)
    ctx.closePath(); ctx.fill()
  }
  if (built < 1) return
  var fit = opts.outfit || { nose: true, scarf: true, hat: true }
  var hx = balls[2][0]
  // Stick arms, each with a twig, behind nothing (drawn first, under the scarf).
  ctx.strokeStyle = "#5a3a22"
  ctx.lineCap = "round"
  ctx.lineWidth = Math.max(1.2, w * 0.03)
  ctx.beginPath()
  ctx.moveTo(cx - r2 * 0.85, y2 - r2 * 0.1); ctx.quadraticCurveTo(cx - r2 * 1.5, y2 - r2 * 0.45, cx - r2 * 2.05, y2 - r2 * 0.95)
  ctx.moveTo(cx + r2 * 0.85, y2 - r2 * 0.05); ctx.quadraticCurveTo(cx + r2 * 1.5, y2 - r2 * 0.3, cx + r2 * 2.1, y2 - r2 * 0.75)
  ctx.stroke()
  ctx.lineWidth = Math.max(0.8, w * 0.018)
  ctx.beginPath()
  ctx.moveTo(cx - r2 * 1.65, y2 - r2 * 0.62); ctx.lineTo(cx - r2 * 1.75, y2 - r2 * 1.05)
  ctx.moveTo(cx - r2 * 1.9, y2 - r2 * 0.82); ctx.lineTo(cx - r2 * 2.25, y2 - r2 * 0.8)
  ctx.moveTo(cx + r2 * 1.7, y2 - r2 * 0.48); ctx.lineTo(cx + r2 * 1.85, y2 - r2 * 0.9)
  ctx.moveTo(cx + r2 * 1.95, y2 - r2 * 0.66); ctx.lineTo(cx + r2 * 2.3, y2 - r2 * 0.55)
  ctx.stroke()
  // Coal: buttons, eyes, and a smile when there is no carrot in the way.
  var coal = function(x, y, r) {
    ctx.fillStyle = "#23232b"
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "rgba(255,255,255,0.55)"
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.32, 0, Math.PI * 2); ctx.fill()
  }
  for (var k = 0; k < 3; k++) coal(balls[1][0] - r2 * 0.02 * k, y2 - r2 * 0.38 + k * r2 * 0.4, r2 * 0.085)
  if (!fit.scarf) coal(balls[1][0], y2 - r2 * 0.78, r2 * 0.075)
  coal(hx - r3 * 0.34, y3 - r3 * 0.18, r3 * 0.1)
  coal(hx + r3 * 0.3, y3 - r3 * 0.2, r3 * 0.1)
  ctx.fillStyle = "#2b2b33"
  for (var mo = -2; mo <= 2; mo++) {
    var mx = hx + mo * r3 * 0.17, my = y3 + r3 * 0.44 - (2 - Math.abs(mo)) * r3 * 0.05
    ctx.beginPath(); ctx.arc(mx, my, r3 * 0.05, 0, Math.PI * 2); ctx.fill()
  }
  if (fit.nose) {
    var cg = ctx.createLinearGradient(0, y3 - r3 * 0.05, 0, y3 + r3 * 0.25)
    cg.addColorStop(0, "#ffad55"); cg.addColorStop(1, "#c9631a")
    ctx.fillStyle = cg
    ctx.beginPath()
    ctx.moveTo(hx + r3 * 0.02, y3 - r3 * 0.02)
    ctx.quadraticCurveTo(hx + r3 * 0.6, y3 + r3 * 0.04, hx + r3 * 1.05, y3 + r3 * 0.16)
    ctx.quadraticCurveTo(hx + r3 * 0.55, y3 + r3 * 0.22, hx + r3 * 0.02, y3 + r3 * 0.24)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "rgba(120,50,10,0.4)"
    ctx.lineWidth = Math.max(0.5, r3 * 0.03)
    ctx.beginPath()
    ctx.moveTo(hx + r3 * 0.36, y3 + r3 * 0.03); ctx.lineTo(hx + r3 * 0.39, y3 + r3 * 0.13)
    ctx.moveTo(hx + r3 * 0.64, y3 + r3 * 0.08); ctx.lineTo(hx + r3 * 0.66, y3 + r3 * 0.16)
    ctx.stroke()
  }
  var scarfHex = opts.themeScarf && THEME ? THEME.scarf : (opts.scarf || "#c0392b")
  if (fit.scarf) {
    var sc = rgbOf(scarfHex)
    var ny = y3 + r3 * 0.82
    // The hanging end, in shade, with a fringe.
    var tail = ctx.createLinearGradient(hx + r3 * 0.2, 0, hx + r3 * 0.7, 0)
    tail.addColorStop(0, rgba(shade(sc, -0.32))); tail.addColorStop(1, rgba(shade(sc, -0.12)))
    ctx.fillStyle = tail
    ctx.beginPath()
    ctx.moveTo(hx + r3 * 0.22, ny - r3 * 0.02)
    ctx.quadraticCurveTo(hx + r3 * 0.55, ny + r3 * 0.5, hx + r3 * 0.6, ny + r3 * 1.12)
    ctx.lineTo(hx + r3 * 0.25, ny + r3 * 1.16)
    ctx.quadraticCurveTo(hx + r3 * 0.22, ny + r3 * 0.5, hx + r3 * 0.02, ny + r3 * 0.06)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = rgba(shade(sc, -0.2))
    ctx.lineWidth = Math.max(0.6, r3 * 0.05)
    ctx.beginPath()
    for (var f = 0; f < 4; f++) {
      var fx = hx + r3 * (0.28 + f * 0.1)
      ctx.moveTo(fx, ny + r3 * 1.13); ctx.lineTo(fx + r3 * 0.02, ny + r3 * 1.3)
    }
    ctx.stroke()
    // The wrap round the neck, rounded, lit from the left.
    var wrap = ctx.createLinearGradient(hx - r3, 0, hx + r3, 0)
    wrap.addColorStop(0, rgba(shade(sc, 0.18))); wrap.addColorStop(0.6, rgba(sc)); wrap.addColorStop(1, rgba(shade(sc, -0.3)))
    ctx.fillStyle = wrap
    ctx.beginPath()
    ctx.moveTo(hx - r3 * 1.0, ny - r3 * 0.14)
    ctx.quadraticCurveTo(hx, ny + r3 * 0.12, hx + r3 * 1.0, ny - r3 * 0.14)
    ctx.quadraticCurveTo(hx + r3 * 1.08, ny + r3 * 0.06, hx + r3 * 0.96, ny + r3 * 0.2)
    ctx.quadraticCurveTo(hx, ny + r3 * 0.44, hx - r3 * 0.96, ny + r3 * 0.2)
    ctx.quadraticCurveTo(hx - r3 * 1.08, ny + r3 * 0.04, hx - r3 * 1.0, ny - r3 * 0.14)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = rgba(shade(sc, -0.35), 0.55)
    ctx.lineWidth = Math.max(0.5, r3 * 0.04)
    ctx.beginPath()
    ctx.moveTo(hx - r3 * 0.5, ny + r3 * 0.0); ctx.quadraticCurveTo(hx - r3 * 0.42, ny + r3 * 0.18, hx - r3 * 0.48, ny + r3 * 0.32)
    ctx.moveTo(hx + r3 * 0.2, ny + r3 * 0.05); ctx.quadraticCurveTo(hx + r3 * 0.28, ny + r3 * 0.2, hx + r3 * 0.22, ny + r3 * 0.36)
    ctx.stroke()
  }
  if (fit.hat) {
    var top = y3 - r3 * 0.86
    // Brim: an ellipse seen a little from above; crown with a soft sheen.
    var crown = ctx.createLinearGradient(hx - r3 * 0.62, 0, hx + r3 * 0.62, 0)
    crown.addColorStop(0, "#3a3a46"); crown.addColorStop(0.35, "#24242d"); crown.addColorStop(1, "#141419")
    ctx.fillStyle = crown
    ctx.beginPath()
    ctx.moveTo(hx - r3 * 0.6, top)
    ctx.lineTo(hx - r3 * 0.56, top - r3 * 0.95)
    ctx.quadraticCurveTo(hx, top - r3 * 1.04, hx + r3 * 0.56, top - r3 * 0.95)
    ctx.lineTo(hx + r3 * 0.6, top)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#1a1a21"
    ctx.beginPath(); ellipsePath(ctx, hx, top - r3 * 0.97, r3 * 0.56, r3 * 0.09); ctx.fill()
    ctx.fillStyle = fit.scarf ? rgba(shade(rgbOf(scarfHex), -0.1)) : "#55556a"
    ctx.beginPath()
    ctx.moveTo(hx - r3 * 0.59, top - r3 * 0.06); ctx.lineTo(hx - r3 * 0.58, top - r3 * 0.24)
    ctx.quadraticCurveTo(hx, top - r3 * 0.3, hx + r3 * 0.58, top - r3 * 0.24)
    ctx.lineTo(hx + r3 * 0.59, top - r3 * 0.06)
    ctx.quadraticCurveTo(hx, top - r3 * 0.12, hx - r3 * 0.59, top - r3 * 0.06)
    ctx.fill()
    var brim = ctx.createLinearGradient(0, top - r3 * 0.1, 0, top + r3 * 0.14)
    brim.addColorStop(0, "#2c2c36"); brim.addColorStop(1, "#111116")
    ctx.fillStyle = brim
    ctx.beginPath(); ellipsePath(ctx, hx, top, r3 * 0.98, r3 * 0.16); ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.14)"
    ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(hx - r3 * 0.44, top - r3 * 0.3); ctx.lineTo(hx - r3 * 0.42, top - r3 * 0.88); ctx.stroke()
    // Snow on the crown.
    ctx.fillStyle = "rgba(255,255,255,0.92)"
    ctx.beginPath()
    ctx.moveTo(hx - r3 * 0.5, top - r3 * 0.96)
    ctx.quadraticCurveTo(hx - r3 * 0.1, top - r3 * 1.16, hx + r3 * 0.36, top - r3 * 1.0)
    ctx.quadraticCurveTo(hx, top - r3 * 0.98, hx - r3 * 0.5, top - r3 * 0.96)
    ctx.fill()
  }
}

// ---------------------------------------------------------------- visitors
// frame: a running time in seconds for legs, wheels and bobbing.

// Santa's sleigh and his team, flying right: three reindeer at a gallop,
// the sleigh a deep red with a gold scroll and curled runners, Santa in it
// with his sack. The lead reindeer's nose glows.
function sleigh(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h)
  var bob = Math.sin(frame * 5.2) * h * 0.035
  // A faint trail of sparkle behind.
  ctx.fillStyle = "rgba(255,240,200,0.55)"
  ctx.beginPath()
  for (var s = 0; s < 7; s++) {
    var tx = w * 0.03 - s * 0.0 + ((frame * 60 + s * 17) % 40) * -0.0 + s * 3
    var ty = h * (0.7 + 0.05 * Math.sin(frame * 3 + s))
    var r = 0.5 + ((s * 7 + Math.floor(frame * 8)) % 5) * 0.25
    ctx.moveTo(tx + r, ty); ctx.arc(tx, ty, r, 0, Math.PI * 2)
  }
  ctx.fill()
  // The team, back to front, each a little out of step.
  var hitch = [w * 0.41, h * 0.6 + bob]
  var deer = []
  for (var i = 0; i < 3; i++) {
    var rx = w * (0.56 + i * 0.145), ry = h * 0.5 + Math.sin(frame * 5.2 + i * 0.9) * h * 0.035
    deer.push([rx, ry])
  }
  ctx.strokeStyle = "rgba(214,170,80,0.85)"
  ctx.lineWidth = 0.9
  ctx.beginPath()
  for (var j = 0; j < 3; j++) { ctx.moveTo(hitch[0], hitch[1]); ctx.quadraticCurveTo((hitch[0] + deer[j][0]) / 2, Math.max(hitch[1], deer[j][1]) + h * 0.06, deer[j][0] - h * 0.08, deer[j][1] - h * 0.02) }
  ctx.stroke()
  for (var d = 0; d < 3; d++) reindeer(ctx, deer[d][0], deer[d][1], h * 0.2, frame + d * 0.21, d === 2)
  ctx.save()
  ctx.translate(0, bob)
  // The sack of presents, behind Santa.
  var sk = ctx.createRadialGradient(w * 0.1, h * 0.3, 1, w * 0.12, h * 0.38, h * 0.18)
  sk.addColorStop(0, "#a07548"); sk.addColorStop(1, "#5e3f22")
  ctx.fillStyle = sk
  ctx.beginPath(); ellipsePath(ctx, w * 0.12, h * 0.4, h * 0.15, h * 0.14); ctx.fill()
  ctx.fillStyle = "#2e86de"; ctx.fillRect(w * 0.085, h * 0.2, h * 0.11, h * 0.09)
  ctx.fillStyle = "#27ae60"; ctx.fillRect(w * 0.125, h * 0.17, h * 0.1, h * 0.12)
  ctx.fillStyle = "#f6d55c"; ctx.fillRect(w * 0.142, h * 0.17, h * 0.025, h * 0.12)
  ctx.fillStyle = "#7a5230"
  ctx.beginPath(); ctx.moveTo(w * 0.07, h * 0.3); ctx.quadraticCurveTo(w * 0.12, h * 0.25, w * 0.17, h * 0.3); ctx.lineTo(w * 0.16, h * 0.33); ctx.quadraticCurveTo(w * 0.12, h * 0.29, w * 0.08, h * 0.33); ctx.fill()
  // Santa: a round red coat with white trim, beard, hat, an arm on the reins.
  var sx = w * 0.27, sy = h * 0.4
  var coat = ctx.createRadialGradient(sx - h * 0.06, sy - h * 0.08, 1, sx, sy, h * 0.19)
  coat.addColorStop(0, "#e5483e"); coat.addColorStop(1, "#9c1b22")
  ctx.fillStyle = coat
  ctx.beginPath(); ellipsePath(ctx, sx, sy, h * 0.15, h * 0.17); ctx.fill()
  ctx.strokeStyle = "#9c1b22"; ctx.lineCap = "round"; ctx.lineWidth = h * 0.065
  ctx.beginPath(); ctx.moveTo(sx + h * 0.06, sy - h * 0.04); ctx.quadraticCurveTo(sx + h * 0.16, sy + h * 0.02, sx + h * 0.24, sy + h * 0.02); ctx.stroke()
  ctx.fillStyle = "#f4f0ea"
  ctx.beginPath(); ctx.arc(sx + h * 0.25, sy + h * 0.02, h * 0.035, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#2a1c14"
  ctx.beginPath(); ctx.arc(sx + h * 0.27, sy + h * 0.02, h * 0.028, 0, Math.PI * 2); ctx.fill()
  var hx = sx + h * 0.03, hy = sy - h * 0.23
  ctx.fillStyle = "#f2c6a2"
  ctx.beginPath(); ctx.arc(hx, hy, h * 0.075, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#f7f4ef"
  ctx.beginPath()
  ctx.moveTo(hx - h * 0.075, hy - h * 0.005)
  ctx.quadraticCurveTo(hx - h * 0.07, hy + h * 0.12, hx + h * 0.01, hy + h * 0.16)
  ctx.quadraticCurveTo(hx + h * 0.09, hy + h * 0.1, hx + h * 0.08, hy + h * 0.0)
  ctx.quadraticCurveTo(hx, hy + h * 0.04, hx - h * 0.075, hy - h * 0.005)
  ctx.fill()
  ctx.fillStyle = "#e9a589"
  ctx.beginPath(); ctx.arc(hx + h * 0.055, hy - h * 0.005, h * 0.02, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#2a2a30"
  ctx.beginPath(); ctx.arc(hx + h * 0.03, hy - h * 0.03, h * 0.011, 0, Math.PI * 2); ctx.fill()
  // Hat, its tip blown back, and the fur band.
  ctx.fillStyle = "#c62828"
  ctx.beginPath()
  ctx.moveTo(hx - h * 0.08, hy - h * 0.045)
  ctx.quadraticCurveTo(hx - h * 0.02, hy - h * 0.2, hx - h * 0.2, hy - h * 0.13)
  ctx.quadraticCurveTo(hx - h * 0.05, hy - h * 0.16, hx + h * 0.08, hy - h * 0.05)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#f7f4ef"
  ctx.beginPath(); ctx.arc(hx - h * 0.205, hy - h * 0.125, h * 0.03, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ellipsePath(ctx, hx, hy - h * 0.05, h * 0.088, h * 0.026); ctx.fill()
  // The sleigh, in front of Santa's lap: a curving body with a gold scroll.
  var body = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.8)
  body.addColorStop(0, "#d23a3a"); body.addColorStop(0.6, "#a3202a"); body.addColorStop(1, "#6e1219")
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.moveTo(w * 0.035, h * 0.4)
  ctx.quadraticCurveTo(w * 0.05, h * 0.5, w * 0.1, h * 0.52)
  ctx.lineTo(w * 0.34, h * 0.52)
  ctx.quadraticCurveTo(w * 0.4, h * 0.5, w * 0.42, h * 0.42)
  ctx.quadraticCurveTo(w * 0.46, h * 0.42, w * 0.45, h * 0.52)
  ctx.quadraticCurveTo(w * 0.43, h * 0.76, w * 0.32, h * 0.77)
  ctx.lineTo(w * 0.1, h * 0.77)
  ctx.quadraticCurveTo(w * 0.03, h * 0.72, w * 0.035, h * 0.4)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = "#e7bf5c"
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(w * 0.06, h * 0.56); ctx.lineTo(w * 0.36, h * 0.56)
  ctx.quadraticCurveTo(w * 0.42, h * 0.56, w * 0.425, h * 0.5)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(w * 0.17, h * 0.66); ctx.quadraticCurveTo(w * 0.2, h * 0.6, w * 0.23, h * 0.66); ctx.quadraticCurveTo(w * 0.26, h * 0.72, w * 0.29, h * 0.66)
  ctx.stroke()
  ctx.fillStyle = "rgba(255,255,255,0.18)"
  ctx.fillRect(w * 0.06, h * 0.53, w * 0.3, h * 0.012)
  // Runners: struts down to a rail that curls up at the front.
  ctx.strokeStyle = "#d8b25a"
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(w * 0.13, h * 0.77); ctx.lineTo(w * 0.12, h * 0.88)
  ctx.moveTo(w * 0.31, h * 0.77); ctx.lineTo(w * 0.32, h * 0.88)
  ctx.moveTo(w * 0.03, h * 0.86)
  ctx.quadraticCurveTo(w * 0.02, h * 0.89, w * 0.06, h * 0.89)
  ctx.lineTo(w * 0.4, h * 0.89)
  ctx.bezierCurveTo(w * 0.47, h * 0.89, w * 0.49, h * 0.78, w * 0.455, h * 0.76)
  ctx.quadraticCurveTo(w * 0.44, h * 0.76, w * 0.445, h * 0.79)
  ctx.stroke()
  ctx.restore()
}

// A reindeer at a gallop, facing right, centred on (x, y), s its body
// length. The lead one's nose glows red.
function reindeer(ctx, x, y, s, frame, lead) {
  var ph = frame * 9
  var fore = Math.sin(ph), hind = Math.sin(ph + 2.2)
  var lift = Math.max(0, Math.sin(ph + 0.6)) * s * 0.05
  y -= lift
  var dark = "#6b4328", fur = "#93613b"
  // Far legs first, darker.
  ctx.strokeStyle = "#5a3820"
  limb(ctx, x + s * 0.26, y + s * 0.08, x + s * 0.32 + fore * s * 0.12, y + s * 0.3, x + s * 0.36 + fore * s * 0.24, y + s * 0.46 - Math.max(0, fore) * s * 0.08, s * 0.08, s * 0.055)
  limb(ctx, x - s * 0.3, y + s * 0.08, x - s * 0.36 + hind * s * 0.14, y + s * 0.3, x - s * 0.3 + hind * s * 0.25, y + s * 0.46 - Math.max(0, -hind) * s * 0.08, s * 0.09, s * 0.055)
  // Body, neck and head.
  var bg = ctx.createLinearGradient(0, y - s * 0.22, 0, y + s * 0.2)
  bg.addColorStop(0, "#a8744a"); bg.addColorStop(0.65, fur); bg.addColorStop(1, dark)
  ctx.fillStyle = bg
  ctx.beginPath(); capsulePath(ctx, x - s * 0.3, y, s * 0.17, x + s * 0.27, y - s * 0.02, s * 0.19); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + s * 0.24, y - s * 0.14)
  ctx.quadraticCurveTo(x + s * 0.42, y - s * 0.3, x + s * 0.5, y - s * 0.42)
  ctx.lineTo(x + s * 0.62, y - s * 0.34)
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.12, x + s * 0.42, y + s * 0.04)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = "rgba(240,226,206,0.8)"
  ctx.beginPath(); ellipsePath(ctx, x + s * 0.43, y - s * 0.12, s * 0.06, s * 0.11); ctx.fill()
  ctx.fillStyle = fur
  ctx.beginPath(); ellipsePath(ctx, x + s * 0.58, y - s * 0.44, s * 0.13, s * 0.09); ctx.fill()
  ctx.beginPath(); ellipsePath(ctx, x + s * 0.7, y - s * 0.4, s * 0.075, s * 0.06); ctx.fill()
  ctx.fillStyle = "#1c120c"
  ctx.beginPath(); ctx.arc(x + s * 0.6, y - s * 0.47, s * 0.022, 0, Math.PI * 2); ctx.fill()
  // Ear and antlers.
  ctx.fillStyle = dark
  ctx.beginPath(); ctx.moveTo(x + s * 0.52, y - s * 0.5); ctx.lineTo(x + s * 0.42, y - s * 0.58); ctx.lineTo(x + s * 0.5, y - s * 0.46); ctx.fill()
  ctx.strokeStyle = "#e6d3b0"
  ctx.lineCap = "round"
  ctx.lineWidth = Math.max(0.8, s * 0.04)
  ctx.beginPath()
  ctx.moveTo(x + s * 0.56, y - s * 0.52); ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.8, x + s * 0.36, y - s * 0.9)
  ctx.moveTo(x + s * 0.52, y - s * 0.72); ctx.lineTo(x + s * 0.62, y - s * 0.86)
  ctx.moveTo(x + s * 0.44, y - s * 0.84); ctx.lineTo(x + s * 0.46, y - s * 0.98)
  ctx.moveTo(x + s * 0.6, y - s * 0.52); ctx.quadraticCurveTo(x + s * 0.64, y - s * 0.72, x + s * 0.58, y - s * 0.82)
  ctx.stroke()
  // Near legs, and the white tail.
  ctx.strokeStyle = dark
  limb(ctx, x + s * 0.2, y + s * 0.1, x + s * 0.26 - fore * s * 0.12, y + s * 0.3, x + s * 0.28 - fore * s * 0.26, y + s * 0.46 - Math.max(0, -fore) * s * 0.08, s * 0.09, s * 0.06)
  limb(ctx, x - s * 0.36, y + s * 0.08, x - s * 0.42 - hind * s * 0.14, y + s * 0.3, x - s * 0.38 - hind * s * 0.26, y + s * 0.46 - Math.max(0, hind) * s * 0.08, s * 0.1, s * 0.06)
  ctx.fillStyle = "#f2eadc"
  ctx.beginPath(); ellipsePath(ctx, x - s * 0.48, y - s * 0.08, s * 0.06, s * 0.045); ctx.fill()
  // Harness band.
  ctx.strokeStyle = "#a3202a"
  ctx.lineWidth = s * 0.06
  ctx.beginPath(); ctx.moveTo(x + s * 0.12, y - s * 0.17); ctx.lineTo(x + s * 0.06, y + s * 0.16); ctx.stroke()
  ctx.fillStyle = "#e7bf5c"
  ctx.beginPath(); ctx.arc(x + s * 0.09, y + s * 0.0, s * 0.03, 0, Math.PI * 2); ctx.fill()
  if (lead) {
    glow(ctx, x + s * 0.77, y - s * 0.4, s * 0.35, [255, 70, 60], 0.55)
    ctx.fillStyle = "#ff4a3a"
    ctx.beginPath(); ctx.arc(x + s * 0.77, y - s * 0.4, s * 0.05, 0, Math.PI * 2); ctx.fill()
  }
}

// A little steam engine with an elf in the cab and one wagon carrying
// `cargo` ("snowman", "tree", "note", "gift"); facing like the yeti.
function train(ctx, w, h, frame, facing, cargo) {
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  if (facing < 0) { ctx.translate(w, 0); ctx.scale(-1, 1) }
  var wheelY = h * 0.84, wr = h * 0.11
  contactShadow(ctx, w * 0.5, h - 1.2, w * 0.5, h * 0.05, 0.4)
  // Smoke: soft puffs that rise, grow and thin out.
  for (var s = 0; s < 4; s++) {
    var t = (frame * 0.9 + s / 4) % 1
    var px = w * (0.88 - t * 0.3), py = h * (0.2 - t * 0.2), pr = h * (0.05 + t * 0.09)
    var sg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 0, px, py, pr)
    sg.addColorStop(0, "rgba(250,250,252," + (0.75 * (1 - t)).toFixed(3) + ")")
    sg.addColorStop(1, "rgba(220,224,232,0)")
    ctx.fillStyle = sg
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill()
  }
  // The wagon: an open box of green boards on a dark frame.
  var wg = ctx.createLinearGradient(0, h * 0.5, 0, h * 0.78)
  wg.addColorStop(0, "#3c9a62"); wg.addColorStop(1, "#22603b")
  if (cargo === "snowman") { ctx.save(); ctx.translate(w * 0.09, h * 0.0); snowmanMini(ctx, w * 0.25, h * 0.58); ctx.restore() }
  else if (cargo === "tree") {
    var tg = ctx.createLinearGradient(w * 0.08, 0, w * 0.34, 0)
    tg.addColorStop(0, "#2f9a5c"); tg.addColorStop(1, "#1b5e37")
    ctx.fillStyle = tg
    ctx.beginPath(); ctx.moveTo(w * 0.21, h * 0.06); ctx.lineTo(w * 0.33, h * 0.54); ctx.lineTo(w * 0.09, h * 0.54); ctx.closePath(); ctx.fill()
    starShape(ctx, w * 0.21, h * 0.07, h * 0.065, "#ffd84d")
  } else if (cargo === "note") { ctx.save(); ctx.translate(w * 0.1, h * 0.22); letter(ctx, w * 0.22, h * 0.32); ctx.restore() }
  else if (cargo === "gift") { ctx.save(); ctx.translate(w * 0.1, h * 0.12); gift(ctx, w * 0.21, h * 0.42, "#c0392b"); ctx.restore() }
  ctx.fillStyle = wg
  ctx.fillRect(w * 0.03, h * 0.52, w * 0.36, h * 0.24)
  ctx.strokeStyle = "rgba(0,0,0,0.22)"
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(w * 0.03, h * 0.6); ctx.lineTo(w * 0.39, h * 0.6)
  ctx.moveTo(w * 0.03, h * 0.68); ctx.lineTo(w * 0.39, h * 0.68)
  ctx.stroke()
  ctx.fillStyle = "rgba(255,255,255,0.22)"
  ctx.fillRect(w * 0.03, h * 0.52, w * 0.36, h * 0.02)
  ctx.fillStyle = "#2b2b33"
  ctx.fillRect(w * 0.02, h * 0.76, w * 0.38, h * 0.04)
  // Coupling.
  ctx.fillStyle = "#3a3a44"
  ctx.fillRect(w * 0.39, h * 0.72, w * 0.07, h * 0.035)
  // The engine: cab at the back, boiler in front with gold bands, chimney,
  // dome and a cowcatcher.
  var cab = ctx.createLinearGradient(w * 0.45, 0, w * 0.62, 0)
  cab.addColorStop(0, "#c8343a"); cab.addColorStop(1, "#8f1f26")
  ctx.fillStyle = cab
  ctx.fillRect(w * 0.45, h * 0.3, w * 0.16, h * 0.48)
  ctx.fillStyle = "#26262e"
  ctx.beginPath(); ctx.moveTo(w * 0.43, h * 0.3); ctx.lineTo(w * 0.635, h * 0.3); ctx.lineTo(w * 0.625, h * 0.24); ctx.lineTo(w * 0.44, h * 0.24); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#f5e6c8"
  ctx.fillRect(w * 0.475, h * 0.36, w * 0.1, h * 0.14)
  // The elf, in the cab window.
  ctx.fillStyle = "#f2c6a2"
  ctx.beginPath(); ctx.arc(w * 0.525, h * 0.44, h * 0.055, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#2e9e5b"
  ctx.beginPath(); ctx.moveTo(w * 0.49, h * 0.42); ctx.quadraticCurveTo(w * 0.52, h * 0.3, w * 0.575, h * 0.33); ctx.lineTo(w * 0.56, h * 0.42); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#f7f4ef"
  ctx.beginPath(); ctx.arc(w * 0.578, h * 0.33, h * 0.018, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#1c1c22"
  ctx.beginPath(); ctx.arc(w * 0.535, h * 0.44, h * 0.01, 0, Math.PI * 2); ctx.fill()
  var boiler = ctx.createLinearGradient(0, h * 0.44, 0, h * 0.78)
  boiler.addColorStop(0, "#e2555a"); boiler.addColorStop(0.35, "#c0392b"); boiler.addColorStop(1, "#7d1d22")
  ctx.fillStyle = boiler
  ctx.fillRect(w * 0.61, h * 0.46, w * 0.27, h * 0.3)
  ctx.beginPath(); ellipsePath(ctx, w * 0.88, h * 0.61, w * 0.025, h * 0.15); ctx.fill()
  ctx.fillStyle = "#e7bf5c"
  ctx.fillRect(w * 0.67, h * 0.46, w * 0.015, h * 0.3)
  ctx.fillRect(w * 0.78, h * 0.46, w * 0.015, h * 0.3)
  ctx.fillStyle = "rgba(255,255,255,0.3)"
  ctx.fillRect(w * 0.61, h * 0.5, w * 0.27, h * 0.025)
  ctx.fillStyle = "#26262e"
  ctx.beginPath(); ctx.moveTo(w * 0.8, h * 0.46); ctx.lineTo(w * 0.79, h * 0.24); ctx.lineTo(w * 0.86, h * 0.24); ctx.lineTo(w * 0.85, h * 0.46); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#e7bf5c"
  ctx.fillRect(w * 0.783, h * 0.22, w * 0.084, h * 0.035)
  ctx.beginPath(); ellipsePath(ctx, w * 0.72, h * 0.455, w * 0.03, h * 0.045); ctx.fill()
  ctx.fillStyle = "#26262e"
  ctx.beginPath(); ctx.moveTo(w * 0.89, h * 0.72); ctx.lineTo(w * 0.97, h * 0.82); ctx.lineTo(w * 0.89, h * 0.82); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#ffe9a8"
  ctx.beginPath(); ctx.arc(w * 0.905, h * 0.5, h * 0.03, 0, Math.PI * 2); ctx.fill()
  glow(ctx, w * 0.92, h * 0.5, h * 0.18, [255, 230, 160], 0.35)
  // Wheels: spoked, turning by the distance travelled, with a rod.
  var wheels = [w * 0.11, w * 0.31, w * 0.66, w * 0.82]
  var a = frame * 7.5
  for (var k = 0; k < wheels.length; k++) {
    var x = wheels[k], big = k >= 2 ? 1.15 : 1, R = wr * big
    ctx.fillStyle = "#1f1f26"
    ctx.beginPath(); ctx.arc(x, wheelY - (R - wr), R, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "#b8bec8"
    ctx.lineWidth = 0.9
    ctx.beginPath()
    for (var sp = 0; sp < 3; sp++) {
      var an = a + sp * Math.PI / 3
      ctx.moveTo(x + Math.cos(an) * R * 0.78, wheelY - (R - wr) + Math.sin(an) * R * 0.78)
      ctx.lineTo(x - Math.cos(an) * R * 0.78, wheelY - (R - wr) - Math.sin(an) * R * 0.78)
    }
    ctx.stroke()
    ctx.strokeStyle = "#c0392b"
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(x, wheelY - (R - wr), R * 0.85, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = "#e7bf5c"
    ctx.beginPath(); ctx.arc(x, wheelY - (R - wr), R * 0.18, 0, Math.PI * 2); ctx.fill()
  }
  var rx = Math.cos(a) * wr * 0.5, ry = Math.sin(a) * wr * 0.5
  ctx.strokeStyle = "#c9ced6"
  ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.moveTo(wheels[2] + rx, wheelY - wr * 0.15 + ry); ctx.lineTo(wheels[3] + rx, wheelY - wr * 0.15 + ry); ctx.stroke()
  ctx.restore()
}

// ------------------------------------------------------------- the robin
//
// A robin, side-on, its feet at (B.x, B.y): olive-brown back and crown, an
// orange-red breast and face, a pale belly, a dark eye with a glint. It
// hops, pecks (the body tips forward), cocks its head, and flies with a
// full wing-beat cycle; landing, it glides with its wings set.
function drawBird(ctx, B, time) {
  ctx.save()
  ctx.translate(B.x, B.y)
  ctx.scale(B.facing, 1)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  var back = "#6e5a45", wingC = "#5a4836", breast = "#e2613a", belly = "#f3ebdf"
  if (B.mode === "perch") {
    var pk = B.peck || 0
    var hop = B.hopY || 0
    contactShadow(ctx, 0.5, 0.4 + hop, 4.6 - hop * 0.4, 1.1, 0.32)
    // Legs, thin and dark.
    ctx.strokeStyle = "#6a4b3a"
    ctx.lineWidth = 0.55
    ctx.beginPath(); ctx.moveTo(-0.4, -2.4); ctx.lineTo(-0.8, 0); ctx.lineTo(0.6, 0); ctx.moveTo(0.9, -2.4); ctx.lineTo(1.2, 0); ctx.lineTo(2.3, 0); ctx.stroke()
    ctx.save()
    ctx.translate(0.2, -5)
    ctx.rotate(-0.12 + pk * 0.6)
    // Tail, cocked up behind.
    ctx.fillStyle = wingC
    ctx.beginPath(); ctx.moveTo(-3.6, -0.6); ctx.lineTo(-9, -3.4); ctx.lineTo(-8.6, -1.6); ctx.lineTo(-3.4, 1.3); ctx.closePath(); ctx.fill()
    // Body: a plump oval, the breast in front, the belly underneath.
    var bodyG = ctx.createLinearGradient(0, -3.4, 0, 3.4)
    bodyG.addColorStop(0, "#82694f"); bodyG.addColorStop(1, back)
    ctx.fillStyle = bodyG
    ctx.beginPath(); ellipsePath(ctx, 0, 0, 4.9, 3.6); ctx.fill()
    ctx.fillStyle = belly
    ctx.beginPath(); ellipsePath(ctx, 0.6, 1.6, 3.6, 1.9); ctx.fill()
    var br = ctx.createRadialGradient(2.6, -0.2, 0.3, 2.4, 0.2, 3.4)
    br.addColorStop(0, "#f07a4c"); br.addColorStop(1, breast)
    ctx.fillStyle = br
    ctx.beginPath(); ellipsePath(ctx, 2.4, 0.2, 2.9, 2.7); ctx.fill()
    // Folded wing over the back.
    ctx.fillStyle = wingC
    ctx.beginPath(); ctx.moveTo(1.6, -2.6); ctx.quadraticCurveTo(-2.4, -3.2, -5.2, 0.4); ctx.quadraticCurveTo(-1.6, 1.0, 1.2, -0.6); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "rgba(240,226,200,0.35)"
    ctx.lineWidth = 0.4
    ctx.beginPath(); ctx.moveTo(0.2, -1.6); ctx.quadraticCurveTo(-2.2, -1.6, -3.8, 0); ctx.stroke()
    // Head: a crown of the back's colour, the face in the breast's.
    var look = B.look || 0
    var hx = 3.8 + pk * 1.4, hy = -3.0 + pk * 2.8
    ctx.save()
    ctx.translate(hx, hy)
    ctx.rotate(look * 0.35)
    ctx.fillStyle = back
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = breast
    ctx.beginPath(); ctx.moveTo(-0.4, 2.4); ctx.quadraticCurveTo(2.6, 2.4, 2.4, -0.6); ctx.quadraticCurveTo(0.8, 0.6, -0.4, 2.4); ctx.fill()
    ctx.fillStyle = "#1a1410"
    ctx.beginPath(); ctx.arc(1.0, -0.5, 0.62, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "rgba(255,255,255,0.9)"
    ctx.beginPath(); ctx.arc(1.2, -0.75, 0.22, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#3b2f26"
    ctx.beginPath(); ctx.moveTo(2.2, -0.5); ctx.lineTo(4.3, 0.05 + pk * 0.4); ctx.lineTo(2.2, 0.5); ctx.closePath(); ctx.fill()
    ctx.restore()
    ctx.restore()
  } else {
    // In flight: the body level, the tail fanned, the wings beating through
    // a full cycle (up, down, tucked) or set for the glide in.
    var glide = B.mode === "in" && (B.t || 0) / 2.4 > 0.72
    var rate = B.mode === "out" ? 11 : 8.5
    var ph = (B.flap || 0) * rate * Math.PI * 2
    var beat = glide ? 0.15 : Math.sin(ph)
    var fold = glide ? 0 : Math.max(0, -Math.cos(ph)) * 0.35
    ctx.save()
    ctx.translate(0, -5)
    ctx.rotate(B.mode === "out" ? -0.22 : (glide ? 0.1 : 0.05))
    // Far wing behind the body.
    wingStroke(ctx, -beat, fold, "#4a3b2c")
    ctx.fillStyle = wingC
    ctx.beginPath(); ctx.moveTo(-3.6, -0.4); ctx.lineTo(-9.6, -2.2); ctx.lineTo(-9.4, 1.4); ctx.lineTo(-3.6, 1.0); ctx.closePath(); ctx.fill()
    var bodyF = ctx.createLinearGradient(0, -2.8, 0, 2.8)
    bodyF.addColorStop(0, "#82694f"); bodyF.addColorStop(1, back)
    ctx.fillStyle = bodyF
    ctx.beginPath(); ellipsePath(ctx, 0, 0, 5.2, 2.8); ctx.fill()
    ctx.fillStyle = belly
    ctx.beginPath(); ellipsePath(ctx, 0.2, 1.3, 3.8, 1.4); ctx.fill()
    ctx.fillStyle = breast
    ctx.beginPath(); ellipsePath(ctx, 2.8, 0.5, 2.6, 2.1); ctx.fill()
    ctx.fillStyle = back
    ctx.beginPath(); ctx.arc(4.8, -1.3, 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = breast
    ctx.beginPath(); ctx.moveTo(4.2, 0.8); ctx.quadraticCurveTo(7, 0.6, 6.8, -1.6); ctx.quadraticCurveTo(5.2, -0.6, 4.2, 0.8); ctx.fill()
    ctx.fillStyle = "#1a1410"
    ctx.beginPath(); ctx.arc(5.7, -1.7, 0.55, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#3b2f26"
    ctx.beginPath(); ctx.moveTo(6.7, -1.6); ctx.lineTo(8.6, -1.1); ctx.lineTo(6.7, -0.7); ctx.closePath(); ctx.fill()
    // Near wing in front.
    wingStroke(ctx, beat, fold, wingC)
    ctx.restore()
  }
  ctx.restore()
}

// One wing from the shoulder: `beat` -1 (down) .. 1 (up), `fold` 0..1.
function wingStroke(ctx, beat, fold, color) {
  var span = 9.5 * (1 - fold * 0.6)
  // The wing's angle from pointing back: up on the upstroke, down and back
  // on the downstroke.
  var a = 0.3 + beat * 1.1
  var ox = 1.2, oy = -1.2
  var tipX = ox - Math.cos(a) * span * 0.8, tipY = oy - Math.sin(a) * span
  var midX = ox - Math.cos(a) * span * 0.45, midY = oy - Math.sin(a) * span * 0.55
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(ox + 0.6, oy)
  ctx.quadraticCurveTo(midX + Math.sin(a) * 1.6, midY - Math.cos(a) * 1.6, tipX, tipY)
  ctx.quadraticCurveTo(midX - Math.sin(a) * 2.2 - 1.2, midY + Math.cos(a) * 2.2 + 0.6, -2.6, 0.8)
  ctx.closePath(); ctx.fill()
  // Primaries: a lighter edge along the trailing side.
  ctx.strokeStyle = "rgba(232,216,192,0.45)"
  ctx.lineWidth = 0.45
  ctx.beginPath(); ctx.moveTo(-1.6, 0.4); ctx.quadraticCurveTo(midX - Math.sin(a) * 1.4 - 0.8, midY + Math.cos(a) * 1.4 + 0.4, tipX, tipY); ctx.stroke()
}

// ------------------------------------------------------------- the hare
//
// A winter hare, side-on, its feet at (R.x, R.y), facing R.dir. White with
// black-tipped ears in winter (a mountain hare's coat), grey-brown with a
// pale belly in spring; a white scut either way. The pose is blended from
// four keys so it moves without popping: sitting, gathered in a crouch,
// stretched out in the air, and sat up tall with the ears raised. R.pose
// runs -1 (crouch) .. 0 (sit) .. 1 (stretched), R.up 0..1 (sat up), R.ears
// 0 (laid back) .. 1 (raised), R.look turns the head, R.nose twitches.

var HARE_KEYS = {
  //        haunch      chest        head          hind foot (heel, toe)    fore foot
  sit:     { hx: -5.2, hy: -6.2, sx: 3.4, sy: -8.2, ex: 8.6, ey: -12.6, fh: -11.5, ft: -1.5, fy: 0, ffx: 5.4, ffy: 0, hr: 6.6, sr: 4.6 },
  crouch:  { hx: -4.2, hy: -5.0, sx: 4.4, sy: -6.0, ex: 10, ey: -8.8, fh: -10.5, ft: -0.5, fy: 0, ffx: 7.2, ffy: 0, hr: 6.4, sr: 4.4 },
  stretch: { hx: -8.6, hy: -8.0, sx: 6.2, sy: -9.4, ex: 13.2, ey: -11.2, fh: -13.5, ft: -21, fy: -3.5, ffx: 14.5, ffy: -3, hr: 5.6, sr: 4.2 },
  up:      { hx: -4.4, hy: -6.6, sx: -0.6, sy: -14.4, ex: 2.6, ey: -20.4, fh: -11, ft: -1, fy: 0, ffx: 2.4, ffy: -7.5, hr: 6.4, sr: 4.4 }
}

function blendKeys(a, b, t) {
  var o = {}
  for (var k in a) o[k] = a[k] + (b[k] - a[k]) * t
  return o
}

function harePalette(coat) {
  if (coat === "brown") return { top: "#a88563", body: "#8c6a4b", under: "#d8c3a5", far: "#6f533a", line: "rgba(60,40,24,0.45)",
                                 ear: "#7d5d40", tip: "#2b211a", inner: "rgba(214,160,150,0.55)", eye: "#1b120c" }
  return { top: "#ffffff", body: "#eef1f6", under: "#d5dcea", far: "#c9d1df", line: "rgba(92,108,140,0.55)",
           ear: "#f2f4f8", tip: "#2c2f38", inner: "rgba(226,176,184,0.6)", eye: "#16181e" }
}

function drawRabbit(ctx, R) {
  var P = harePalette(R.coat)
  var pose = R.pose || 0, up = smoothstep01(R.up || 0)
  var k = pose < 0 ? blendKeys(HARE_KEYS.sit, HARE_KEYS.crouch, -pose) : blendKeys(HARE_KEYS.sit, HARE_KEYS.stretch, pose)
  if (up > 0.001) k = blendKeys(k, HARE_KEYS.up, up)
  var lift = R.lift || 0
  // Its shadow on the snow, smaller and fainter the higher it is.
  var sz = R.size > 0 && R.size < 4 ? R.size : 1
  var sh = Math.max(0.15, 1 - lift / (14 * sz))
  contactShadow(ctx, R.x - R.dir * 1.5 * sz, R.y + lift + 0.4, (12 * sh + 2) * sz, (1.7 * sh + 0.3) * sz, 0.3 * sh)
  ctx.save()
  ctx.translate(R.x, R.y)
  ctx.scale(R.dir * sz, sz)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  // The far ear and far legs, a shade darker, behind the body.
  var earA = lerpN(-2.85, -1.72, R.ears === undefined ? 0.6 : R.ears) + (R.look || 0) * 0.15
  var twitch = Math.max(0, Math.sin((R.nose || 0) * 2.3)) * 0.35
  ear(ctx, k.ex - 2.2, k.ey - 2.2, earA - 0.16, 9.6, 2.1, P.far, P.tip, null)
  ctx.fillStyle = P.far
  ctx.beginPath(); capsulePath(ctx, k.fh - 0.6, k.fy - 1.1, 1.3, k.ft - 0.6, k.fy - 0.9, 1.0); ctx.fill()
  ctx.beginPath(); capsulePath(ctx, k.sx - 0.4, k.sy + 2, 1.3, k.ffx - 1.6, k.ffy - 0.9, 0.9); ctx.fill()
  // Body: haunch, back and chest in one shape, lit from above.
  var top = Math.min(k.hy - k.hr, k.sy - k.sr) - 1
  var g = ctx.createLinearGradient(0, top, 0, 0.5)
  g.addColorStop(0, P.top); g.addColorStop(0.55, P.body); g.addColorStop(1, P.under)
  ctx.fillStyle = g
  ctx.beginPath()
  capsulePath(ctx, k.hx, k.hy, k.hr, k.sx, k.sy, k.sr)
  ellipsePath(ctx, k.hx + 0.3, k.hy + 0.4, k.hr * 1.08, k.hr * 0.98)
  ctx.fill()
  ctx.strokeStyle = P.line
  ctx.lineWidth = 0.55
  ctx.beginPath()
  ctx.moveTo(k.hx - k.hr * 1.02, k.hy + 1.2)
  ctx.quadraticCurveTo(k.hx - k.hr * 0.9, k.hy - k.hr * 1.05, k.hx + 0.5, k.hy - k.hr * 0.98)
  ctx.quadraticCurveTo((k.hx + k.sx) / 2 + 1, Math.min(k.hy - k.hr, k.sy - k.sr) - 0.2, k.sx + 0.5, k.sy - k.sr * 0.95)
  ctx.stroke()
  // The scut, a white puff at the rump.
  ctx.fillStyle = "#ffffff"
  ctx.beginPath(); ellipsePath(ctx, k.hx - k.hr * 0.98, k.hy - k.hr * 0.25, 1.9, 1.6); ctx.fill()
  // Near hind foot, long, along the snow (or kicked back in the air), and
  // the near foreleg.
  ctx.fillStyle = P.body
  ctx.beginPath(); capsulePath(ctx, k.fh, k.fy - 1.2, 1.5, k.ft, k.fy - 0.9, 1.1); ctx.fill()
  ctx.strokeStyle = P.line
  ctx.lineWidth = 0.45
  ctx.beginPath(); ctx.moveTo(Math.min(k.fh, k.ft) + 0.4, k.fy + 0.2); ctx.lineTo(Math.max(k.fh, k.ft) - 0.4, k.fy + 0.2); ctx.stroke()
  ctx.fillStyle = P.body
  ctx.beginPath(); capsulePath(ctx, k.sx + 0.6, k.sy + 1.6, 1.45, k.ffx, k.ffy - 0.9, 0.95); ctx.fill()
  // Head: a rounded skull, the muzzle a little lower, the near ear.
  ctx.save()
  ctx.translate(k.ex, k.ey)
  ctx.rotate((R.look || 0) * 0.25 + pose * 0.12)
  var hg = ctx.createLinearGradient(0, -3.8, 0, 3.4)
  hg.addColorStop(0, P.top); hg.addColorStop(1, P.under)
  ctx.fillStyle = hg
  ctx.beginPath(); ellipsePath(ctx, 0, 0, 4.3, 3.5); ellipsePath(ctx, 2.6, 1.1, 2.4, 2.1); ctx.fill()
  ctx.strokeStyle = P.line
  ctx.lineWidth = 0.45
  ctx.beginPath(); ctx.moveTo(-3.2, -2.4); ctx.quadraticCurveTo(0.5, -4.1, 3.6, -1.6); ctx.stroke()
  // Eye with a glint; nose, twitching.
  ctx.fillStyle = P.eye
  ctx.beginPath(); ellipsePath(ctx, 1.4, -0.7, 0.85, 0.95); ctx.fill()
  ctx.fillStyle = "rgba(255,255,255,0.85)"
  ctx.beginPath(); ctx.arc(1.7, -1.05, 0.28, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#c98f98"
  ctx.beginPath(); ellipsePath(ctx, 4.7, 0.5 - twitch, 0.6, 0.48 + twitch * 0.4); ctx.fill()
  ctx.strokeStyle = "rgba(120,124,140,0.35)"
  ctx.lineWidth = 0.25
  ctx.beginPath(); ctx.moveTo(4.2, 1.1); ctx.lineTo(7.6, 0.4 - twitch); ctx.moveTo(4.2, 1.4); ctx.lineTo(7.4, 2.2 - twitch); ctx.stroke()
  ctx.restore()
  ear(ctx, k.ex - 1.2, k.ey - 2.4, earA, 10.4, 2.3, P.ear, P.tip, P.inner)
  ctx.restore()
}

// One ear from its root at (x, y), `a` radians from pointing forward
// (-pi/2 straight up), `len` long: a long leaf shape, dark at the tip,
// with a warm inner shade on the near ear.
function ear(ctx, x, y, a, len, wid, color, tip, inner) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(a)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, -wid * 0.5)
  ctx.quadraticCurveTo(len * 0.55, -wid * 1.05, len, -0.2)
  ctx.quadraticCurveTo(len * 0.55, wid * 0.95, 0, wid * 0.5)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = "rgba(92,108,140,0.4)"
  ctx.lineWidth = 0.4
  ctx.stroke()
  if (inner) {
    ctx.fillStyle = inner
    ctx.beginPath()
    ctx.moveTo(1.2, 0.1)
    ctx.quadraticCurveTo(len * 0.5, wid * 0.55, len * 0.8, 0.2)
    ctx.quadraticCurveTo(len * 0.5, -wid * 0.05, 1.2, 0.1)
    ctx.fill()
  }
  ctx.fillStyle = tip
  ctx.beginPath()
  ctx.moveTo(len * 0.8, -wid * 0.62)
  ctx.quadraticCurveTo(len * 0.93, -wid * 0.45, len, -0.2)
  ctx.quadraticCurveTo(len * 0.93, wid * 0.4, len * 0.8, wid * 0.55)
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

// ------------------------------------------------------------- frost
//
// Frost on a cold window: a thin rime along the top edge just under the
// snow, and feathered crystals growing in from the two top corners, each
// window its own pattern. `s.frost` 0..1 says how far it has come in.
function drawFrost(ctx, s, time) {
  var f = s.frost || 0
  if (f < 0.04 || s.w < 40 || s.h < 30) return
  var seed = hashString(String(s.id) + "frost")
  var rnd = seeded(seed)
  // Rime along the edge: a soft white band fading down into the window.
  var band = 2 + 3.5 * f
  var g = ctx.createLinearGradient(0, s.y, 0, s.y + band)
  g.addColorStop(0, "rgba(236,244,255," + (0.42 * f).toFixed(3) + ")")
  g.addColorStop(1, "rgba(236,244,255,0)")
  ctx.fillStyle = g
  ctx.fillRect(s.x, s.y, s.w, band)
  // Feathered crystals in the corners: a few branches from each corner,
  // each with short side-shoots, thin and translucent.
  var reach = Math.min(10 + 24 * f, s.w * 0.12, s.h * 0.4)
  ctx.beginPath()
  for (var c = 0; c < 2; c++) {
    var cx = c === 0 ? s.x : s.x + s.w, side = c === 0 ? 1 : -1
    var n = 4
    for (var i = 0; i < n; i++) {
      var ang = (0.12 + (i + rnd() * 0.6) / n * 1.3)
      var len = reach * (0.55 + rnd() * 0.45)
      var dx = Math.cos(ang) * side, dy = Math.sin(ang)
      ctx.moveTo(cx, s.y + 0.5)
      ctx.lineTo(cx + dx * len, s.y + 0.5 + dy * len)
      var shoots = 3
      for (var j = 1; j <= shoots; j++) {
        var t = j / (shoots + 1), bl = len * (0.32 - t * 0.18)
        var bx = cx + dx * len * t, by = s.y + 0.5 + dy * len * t
        for (var q = -1; q <= 1; q += 2) {
          var ba = ang + q * 0.7
          ctx.moveTo(bx, by)
          ctx.lineTo(bx + Math.cos(ba) * side * bl, by + Math.sin(ba) * bl)
        }
      }
    }
  }
  ctx.strokeStyle = "rgba(232,242,255," + (0.4 * f).toFixed(3) + ")"
  ctx.lineWidth = 0.55
  ctx.lineCap = "round"
  ctx.stroke()
  // A cold sheen in each corner under the crystals.
  for (var e = 0; e < 2; e++) {
    var ex = e === 0 ? s.x : s.x + s.w
    var rg = ctx.createRadialGradient(ex, s.y, 0, ex, s.y, reach * 1.1)
    rg.addColorStop(0, "rgba(220,236,255," + (0.22 * f).toFixed(3) + ")")
    rg.addColorStop(1, "rgba(220,236,255,0)")
    ctx.fillStyle = rg
    ctx.fillRect(e === 0 ? ex : ex - reach * 1.1, s.y, reach * 1.1, reach * 1.1)
  }
}
