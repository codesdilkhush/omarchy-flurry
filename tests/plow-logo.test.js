// The Omarchy wordmark on the plow: Omarchy's ASCII logo as a bitmap,
// inside the hood side, Qt-clean, and readable whichever way it drives.
const test = require("node:test")
const assert = require("node:assert")
const load = require("./load")
const Q = require("./qtcanvas")
const D = load("lib/draw.js")

test("the logo bitmap is whole and every run is inside it", () => {
  const L = D.OMARCHY_LOGO
  assert.strictEqual(L.w, 81); assert.strictEqual(L.h, 19); assert.strictEqual(L.runs.length, L.h)
  let cells = 0
  for (const row of L.runs) for (let i = 0; i < row.length; i += 2) {
    assert.ok(row[i] >= 0 && row[i + 1] > 0 && row[i] + row[i + 1] <= L.w)
    cells += row[i + 1]
  }
  assert.ok(cells > 600, cells + " cells")
})

test("it paints clean, inside the hood side, both ways", () => {
  for (const dir of [1, -1]) {
    const pts = []
    const e = Q.paint(ctx => {
      const p = new Proxy(ctx, { get(t, k) {
        const v = t[k]
        if (typeof v !== "function") return v
        return (...a) => { if (k === "rect") pts.push(a); return v.apply(t, a) }
      } })
      D.drawDozerLogo(p, { dir })
    })
    assert.strictEqual(e, null, e && e.message)
    for (const [x, y, w, h] of pts) {
      assert.ok(x >= -145.01 && x + w <= -51.8, "x " + x)
      assert.ok(y >= -57.6 && y + h <= -34.7, "y " + y)
    }
  }
})
