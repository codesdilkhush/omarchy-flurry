// Render-layer regression tests for the transparent overlay and the
// video-matched snow look. Run with the other suites:
//   node --test tests/render.test.js tests/phase5.test.js ...
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const FlakeShape = require(path.join(root, "js", "FlakeShape.js"));

const renderers = [
  "qml/SnowRenderer.qml",
  "qml/SnowBankRenderer.qml",
  "qml/SnowTrackRenderer.qml",
  "qml/SnowPlowRenderer.qml",
  "qml/SnowmanRenderer.qml",
  "qml/components/SnowBallItem.qml"
];

test("no renderer asks for a framebuffer object target", () => {
  for (const file of renderers) {
    const src = read(file);
    assert.doesNotMatch(src, /renderTarget\s*:\s*Canvas\.FramebufferObject/,
      file + " must keep the portable, alpha-correct Canvas.Image target");
    assert.match(src, /globalCompositeOperation\s*=\s*"source-over"/,
      file + " must reset its paint state on every pass");
    assert.match(src, /clearRect\(0,\s*0,\s*width,\s*height\)/,
      file + " must clear previous frame content");
  }
});

test("overlay requests a transparent surface format up front", () => {
  const src = read("qml/OverlaySurface.qml");
  assert.match(src, /color:\s*"transparent"/);
  assert.match(src, /surfaceFormat\s*\{\s*\n?\s*opaque:\s*false/,
    "an opaque surface format is what makes a fullscreen overlay render black");
});

test("small flakes are soft round points, not six-armed sparkles", () => {
  const calls = [];
  const ctx = {
    set globalAlpha(v) { calls.push(["alpha", v]); },
    get globalAlpha() { return 1; },
    set globalCompositeOperation(v) { calls.push(["comp", v]); },
    set fillStyle(v) { calls.push(["fill", v]); },
    set strokeStyle(v) { calls.push(["stroke", v]); },
    beginPath() { calls.push(["begin"]); },
    arc(x, y, r) { calls.push(["arc", x, y, r]); },
    fill() { calls.push(["fillPath"]); },
    stroke() { calls.push(["strokePath"]); },
    moveTo() {}, lineTo() {}, closePath() {}
  };
  FlakeShape.draw(ctx, 10, 20, 1.4, 0, 0.8, 1);
  assert.equal(calls.filter((c) => c[0] === "strokePath").length, 0);
  assert.ok(calls.some((c) => c[0] === "arc" && c[3] === 1.4));
  assert.ok(calls.some((c) => c[0] === "arc" && c[3] > 1.4)); // halo
});

test("large detached chunks keep their dendritic shape", () => {
  let strokes = 0, arcs = 0;
  const ctx = {
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
    set globalCompositeOperation(v) {},
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {},
    beginPath() {}, arc() { arcs++; }, fill() {},
    stroke() { strokes++; }, moveTo() {}, lineTo() {}, closePath() {}
  };
  FlakeShape.draw(ctx, 0, 0, 3.2, 12, 1, 2);
  assert.equal(strokes, 1);
  assert.ok(arcs >= 2);
});
