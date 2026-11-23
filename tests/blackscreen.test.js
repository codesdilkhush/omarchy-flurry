// Black-screen guard and the bugs fixed alongside it in 1.2.0.
// Pure JS plus source audits; no desktop needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const Compositor = require(path.join(root, "js", "Compositor.js"));
const DisplayMath = require(path.join(root, "js", "DisplayMath.js"));
const Settings = require(path.join(root, "js", "Settings.js"));
const Simulation = require(path.join(root, "js", "Simulation.js"));
const ParticleSystem = require(path.join(root, "js", "ParticleSystem.js"));
const MathUtils = require(path.join(root, "js", "MathUtils.js"));
const Constants = require(path.join(root, "js", "Constants.js"));

// ---- compositor probe -------------------------------------------------------

test("quirk enabled (Hyprland 0.57.0 default) is unsafe", () => {
  const r = Compositor.parseQuirkProbe('{"option":"quirks:skip_non_kms_dmabuf_formats","int":1,"set":false}');
  assert.equal(r.state, Compositor.UNSAFE);
});

test("quirk disabled is safe, in every value shape hyprctl uses", () => {
  for (const text of ['{"int":0,"set":true}', '{"bool":false}', '{"str":"false"}', ' {"int": 0} \n'])
    assert.equal(Compositor.parseQuirkProbe(text).state, Compositor.SAFE, text);
  for (const text of ['{"bool":true}', '{"str":"true"}', '{"value":1}'])
    assert.equal(Compositor.parseQuirkProbe(text).state, Compositor.UNSAFE, text);
});

test("older Hyprland without the option is safe", () => {
  assert.equal(Compositor.parseQuirkProbe("no such option").state, Compositor.SAFE);
});

test("anything unreadable is unknown, never a crash", () => {
  for (const text of [undefined, null, "", "   ", "garbage", "[1,2]", "null", '{"option":"x"}',
    "hyprctl: command not found"])
    assert.equal(Compositor.parseQuirkProbe(text).state, Compositor.UNKNOWN, String(text));
});

test("overlay is never mapped while the probe runs or when unsafe (guard on)", () => {
  assert.equal(Compositor.overlayAllowed(Compositor.CHECKING, true), false);
  assert.equal(Compositor.overlayAllowed(Compositor.UNSAFE, true), false);
  assert.equal(Compositor.overlayAllowed(Compositor.SAFE, true), true);
  assert.equal(Compositor.overlayAllowed(Compositor.UNKNOWN, true), true);
  // Guard off: the user takes responsibility.
  assert.equal(Compositor.overlayAllowed(Compositor.UNSAFE, false), true);
  assert.equal(Compositor.overlayAllowed(Compositor.CHECKING, false), true);
});

test("transparencyGuard defaults on and survives a write", () => {
  assert.equal(Settings.DEFAULTS.transparencyGuard, true);
  assert.equal(Settings.normalize({}).transparencyGuard, true);
  assert.equal(Settings.toEntry({ transparencyGuard: false }, "snowglobe").transparencyGuard, false);
  assert.equal(Settings.normalize({ transparencyGuard: "no" }).transparencyGuard, true);
});

// ---- overlay surface contract ------------------------------------------------

test("overlay is mapped only when ready and wanted, and stops its frame loop when hidden", () => {
  const src = read("qml/OverlaySurface.qml");
  assert.match(src, /visible:\s*surface\.ready\s*&&\s*surface\.wanted/);
  assert.match(src, /Qt\.callLater\(function\(\)\s*\{\s*surface\.ready\s*=\s*true\s*\}\)/);
  assert.match(src, /running:\s*surface\.visible/, "MonitorScene must stop with its window");
  const scene = read("qml/MonitorScene.qml");
  assert.match(scene, /active:\s*scene\.simulation !== null && scene\.running/);
});

test("service gates the overlay on the compositor probe and leaves builder mode with it", () => {
  const src = read("Service.qml");
  assert.match(src, /Compositor\.overlayAllowed\(compositorState, settings\.transparencyGuard\)/);
  assert.match(src, /startCompositorProbe\(\)/);
  assert.match(src, /builderActive:\s*snowglobe\.builderActive && snowglobe\.overlayMapped/);
  assert.match(src, /else exitBuilder\(\)/);
});

// ---- fixed bugs ---------------------------------------------------------------

test("rotated monitors swap their logical width and height", () => {
  assert.deepEqual(DisplayMath.logicalSize(2560, 1440, 1, 0), { width: 2560, height: 1440 });
  assert.deepEqual(DisplayMath.logicalSize(2560, 1440, 2, 1), { width: 720, height: 1280 });
  assert.deepEqual(DisplayMath.logicalSize(2560, 1440, 1, 3), { width: 1440, height: 2560 });
  assert.deepEqual(DisplayMath.logicalSize(2560, 1440, 1, 7), { width: 1440, height: 2560 });
  assert.deepEqual(DisplayMath.logicalSize(2560, 1440, 1, 2), { width: 2560, height: 1440 });
  assert.deepEqual(DisplayMath.logicalSize(2560, 1440, 1, undefined), { width: 2560, height: 1440 });
});

function makeSim(quality) {
  const random = MathUtils.createRandom(7);
  const system = ParticleSystem.create(Constants.MAX_PARTICLES.high, random);
  system.width = 800; system.height = 500;
  return Simulation.create({ system, particleSystem: ParticleSystem, random, quality,
    capacities: Constants.MAX_PARTICLES, stepSeconds: Constants.STEP_SECONDS });
}

test("changing quality updates the frame budget used by adaptive quality", () => {
  const sim = makeSim("high");
  assert.equal(sim.frameIntervalMs, Simulation.frameIntervalFor("high"));
  Simulation.setQuality(sim, "balanced");
  assert.equal(sim.frameIntervalMs, Simulation.frameIntervalFor("balanced"));
  // Steady 33 ms frames at balanced quality must not read as drift.
  for (let i = 0; i < 240; i++) Simulation.update(sim, 0.033);
  assert.ok(Simulation.metrics(sim).frameDriftMs < 1, "drift " + Simulation.metrics(sim).frameDriftMs);
});

test("Hyprland event names used for fast polling are real ones", () => {
  const events = Constants.FAST_POLL_EVENTS;
  for (const name of ["openwindow", "closewindow", "movewindow", "fullscreen", "workspace", "monitoradded"])
    assert.ok(events.includes(name), name);
  assert.ok(!events.includes("windowadded") && !events.includes("windowremoved"));
});
