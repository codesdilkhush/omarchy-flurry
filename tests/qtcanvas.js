// A strict stand-in for the QML Canvas 2D context (Qt 6 Context2D,
// https://doc.qt.io/qt-6/qml-qtquick-context2d.html). It records nothing
// and draws nothing; it throws, the way Qt's V4 bindings do, on:
//   * any method or property Qt's Context2D does not have (ctx.ellipse with
//     the browser's signature, roundRect, filter, Path2D, conic gradients,
//     letterSpacing, imageSmoothingQuality, ...);
//   * the argument checks Qt makes and a browser mock would not:
//     arc/arcTo with a negative radius (INDEX_SIZE_ERR), gradients with
//     non-finite coordinates (NOT_SUPPORTED_ERR) or a negative radius,
//     addColorStop with an offset outside 0..1 or a colour Qt cannot parse
//     (SYNTAX_ERR);
//   * values Qt silently ignores but which mean a bug here: a NaN colour
//     string, a globalCompositeOperation Qt does not know, a NaN coordinate
//     or line width;
//   * save/restore that do not balance by the end of a paint (check()).
// In QML an exception thrown inside onPaint ends that paint at once: the
// rest of the frame (later layers, visitors, the ground) is never drawn.

"use strict"

const COMPOSITE = new Set(["source-atop", "source-in", "source-out", "source-over", "destination-atop", "destination-in",
  "destination-out", "destination-over", "lighter", "copy", "xor", "qt-clear", "qt-destination", "qt-multiply",
  "qt-screen", "qt-overlay", "qt-darken", "qt-lighten", "qt-color-dodge", "qt-color-burn", "qt-hard-light",
  "qt-soft-light", "qt-difference", "qt-exclusion"])
const LINECAP = new Set(["butt", "round", "square"])
const LINEJOIN = new Set(["bevel", "round", "miter"])
const NAMED = new Set(["transparent", "white", "black", "red", "green", "blue", "yellow", "orange", "gold", "gray", "grey"])

class QtCanvasError extends Error {}
function fail(msg) { throw new QtCanvasError("Context2D: " + msg) }

// What Qt's qt_color_from_string accepts, kept strict: #rgb, #rrggbb,
// #aarrggbb, rgb()/rgba()/hsl()/hsla() with finite plain-decimal numbers
// (no exponent, no NaN), alpha 0..1, or a CSS name.
function validColor(c) {
  if (typeof c !== "string") return false
  const s = c.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true
  const m = /^(rgb|rgba|hsl|hsla)\(([^)]*)\)$/.exec(s)
  if (m) {
    const parts = m[2].split(",").map(x => x.trim())
    const want = m[1].endsWith("a") ? 4 : 3
    if (parts.length !== want) return false
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].replace(/%$/, "")
      if (!/^-?\d+(\.\d+)?$/.test(p)) return false
      if (i === 3 && (+p < 0 || +p > 1)) return false
    }
    return true
  }
  return NAMED.has(s.toLowerCase())
}

function finite(...a) { return a.every(v => typeof v === "number" && isFinite(v)) }

function makeGradient() {
  return {
    addColorStop(offset, color) {
      if (!(typeof offset === "number" && isFinite(offset)) || offset < 0 || offset > 1) fail("addColorStop: offset out of range: " + offset)
      if (!validColor(color)) fail("addColorStop: not a valid color string: " + color)
    }
  }
}

function create(opts) {
  opts = opts || {}
  let depth = 0
  const state = { fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
                  lineCap: "butt", lineJoin: "miter", miterLimit: 10, font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
                  shadowBlur: 0, shadowColor: "rgba(0,0,0,0)", shadowOffsetX: 0, shadowOffsetY: 0, fillRule: 1, lineDashOffset: 0 }
  const calls = { count: 0 }
  const coords = (name, n) => function(...a) {
    calls.count++
    if (a.length < n) fail(name + ": needs " + n + " arguments, got " + a.length)
    if (opts.strictNaN !== false && !finite(...a.slice(0, n))) fail(name + ": non-finite argument " + JSON.stringify(a))
  }
  const methods = {
    save() { depth++ },
    restore() { if (depth > 0) depth-- },   // Qt (and browsers) ignore a restore with nothing saved
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, clip() {},
    moveTo: coords("moveTo", 2), lineTo: coords("lineTo", 2),
    quadraticCurveTo: coords("quadraticCurveTo", 4), bezierCurveTo: coords("bezierCurveTo", 6),
    rect: coords("rect", 4), fillRect: coords("fillRect", 4), strokeRect: coords("strokeRect", 4), clearRect: coords("clearRect", 4),
    translate: coords("translate", 2), scale: coords("scale", 2), rotate: coords("rotate", 1),
    setTransform: coords("setTransform", 6), transform: coords("transform", 6), shear: coords("shear", 2),
    roundedRect: coords("roundedRect", 6), text() {}, fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 6 } },
    drawImage() {}, createImageData() { return {} }, getImageData() { return {} }, putImageData() {},
    createPattern() { return {} }, setLineDash() {}, getLineDash() { return [] }, isPointInPath() { return false },
    reset() { depth = 0 },
    arc(x, y, r, a0, a1) {
      calls.count++
      if (arguments.length < 5) fail("arc: needs 5 arguments")
      if (isFinite(r) && r < 0) fail("arc: Incorrect argument radius " + r)
      if (!finite(x, y, r, a0, a1)) fail("arc: non-finite argument " + JSON.stringify([x, y, r, a0, a1]))
    },
    arcTo(x1, y1, x2, y2, r) {
      if (isFinite(r) && r < 0) fail("arcTo: Incorrect argument radius " + r)
      if (!finite(x1, y1, x2, y2, r)) fail("arcTo: non-finite argument")
    },
    // Qt's own ellipse takes a bounding box, not centre and radii; nothing
    // here may call it (use Draw.ellipsePath).
    ellipse() { fail("ellipse: Qt's signature is ellipse(x, y, w, h); use ellipsePath") },
    createLinearGradient(x0, y0, x1, y1) {
      if (!finite(x0, y0, x1, y1)) fail("createLinearGradient(): Incorrect arguments " + JSON.stringify([x0, y0, x1, y1]))
      return makeGradient()
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      if (!finite(x0, y0, r0, x1, y1, r1)) fail("createRadialGradient(): Incorrect arguments " + JSON.stringify([x0, y0, r0, x1, y1, r1]))
      if (r0 < 0 || r1 < 0) fail("createRadialGradient(): negative radius " + r0 + ", " + r1)
      return makeGradient()
    },
    createConicalGradient(x, y, a) { if (!finite(x, y, a)) fail("createConicalGradient(): Incorrect arguments"); return makeGradient() }
  }
  const setters = {
    fillStyle(v) { if (typeof v === "string" && !validColor(v)) fail("fillStyle: invalid colour " + v) },
    strokeStyle(v) { if (typeof v === "string" && !validColor(v)) fail("strokeStyle: invalid colour " + v) },
    shadowColor(v) { if (!validColor(v)) fail("shadowColor: invalid colour " + v) },
    lineWidth(v) { if (!(typeof v === "number" && isFinite(v))) fail("lineWidth: " + v) },
    globalAlpha(v) { if (!(typeof v === "number" && isFinite(v))) fail("globalAlpha: " + v) },
    globalCompositeOperation(v) { if (!COMPOSITE.has(v)) fail("globalCompositeOperation not supported by Qt: " + v) },
    lineCap(v) { if (!LINECAP.has(v)) fail("lineCap: " + v) },
    lineJoin(v) { if (!LINEJOIN.has(v)) fail("lineJoin: " + v) },
    miterLimit() {}, font() {}, textAlign() {}, textBaseline() {}, shadowBlur() {}, shadowOffsetX() {}, shadowOffsetY() {},
    fillRule() {}, lineDashOffset() {}
  }
  const target = { __check() { if (depth !== 0) fail("unbalanced save/restore: depth " + depth) }, __calls: calls }
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k]
      if (typeof k === "symbol") return undefined
      if (k in methods) return methods[k]
      if (k in state) return state[k]
      if (k === "canvas") return { width: opts.width || 1920, height: opts.height || 1080 }
      fail("no such member in Qt's Context2D: " + String(k))
    },
    set(t, k, v) {
      if (!(k in setters)) fail("no such property in Qt's Context2D: " + String(k))
      setters[k](v)
      state[k] = v
      return true
    }
  })
}

// Runs paint(ctx) against a strict context and checks the save/restore
// balance. Returns the error (or null).
function paint(fn, opts) {
  const ctx = create(opts)
  try { fn(ctx); ctx.__check(); return null } catch (e) { return e }
}

module.exports = { create, paint, validColor, QtCanvasError }
