// Regression tests for the snow accumulation, layering and snowman roller fixes.
// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = (f) => require(path.join(__dirname, "..", "js", f));

const Bank = js("SnowBank.js"), Col = js("Collision.js"), PS = js("ParticleSystem.js"),
  Sim = js("Simulation.js"), Roll = js("SnowRoll.js"), Model = js("SnowmanModel.js"),
  Settings = js("Settings.js"), DisplayMath = js("DisplayMath.js"), WG = js("WindowGeometry.js"),
  MU = js("MathUtils.js"), C = js("Constants.js");

// ---- helpers ---------------------------------------------------------------
function makeSim(opts) {
  opts = opts || {};
  const W = opts.width || 1920, H = opts.height || 1080;
  const random = MU.createRandom(MU.hashSeed("T"));
  const system = PS.create(C.MAX_PARTICLES.high, random); system.width = W; system.height = H;
  const det = PS.create(C.MAX_DETACHED, random); det.width = W; det.height = H;
  return Sim.create({
    system, particleSystem: PS, random, stepSeconds: C.STEP_SECONDS, maxStepsPerFrame: 5,
    maxBacklogSeconds: 0.25, capacities: C.MAX_PARTICLES, density: opts.density || 1, wind: opts.wind === undefined ? 1 : opts.wind,
    quality: "balanced", adaptiveScale: 1, bankModule: Bank, collisionModule: Col, detachedSystem: det,
    slideSpeed: C.WINDOW_SLIDE_SPEED, detachSpeed: C.WINDOW_DETACH_SPEED, windowSlideAmount: C.WINDOW_SLIDE_AMOUNT,
    detachMass: C.WINDOW_DETACH_MASS, detachMaxPerEvent: C.WINDOW_DETACH_MAX_PER_EVENT,
    velocityInherit: C.WINDOW_VELOCITY_INHERIT, detachedGravity: C.DETACHED_GRAVITY, detachedLift: C.DETACHED_LIFT,
    accumulateOnWindows: true, maxSurfaces: 96, depositAmount: C.DEPOSIT_AMOUNT, depositSpread: C.DEPOSIT_SPREAD,
    settleSteps: C.BANK_SETTLE_STEPS, slideAmount: C.BANK_SLIDE_AMOUNT, redistributeAmount: C.BANK_REDISTRIBUTE_AMOUNT,
    erodeAmount: C.BANK_ERODE_AMOUNT, segmentWidth: C.SEGMENT_WIDTH, windowMaxDepth: C.WINDOW_MAX_DEPTH,
    groundMaxDepth: C.GROUND_MAX_DEPTH });
}
const win = (id, x, y, w, h, o) => Object.assign({ id, monitorName: "M", x, y, width: w, height: h,
  floating: false, fullscreen: false, special: false, focusRank: 0, hasMoved: false, speed: 0 }, o || {});
const geo = (windows, mon) => ({ monitors: { M: Object.assign({ name: "M", x: 0, y: 0, width: 1920, height: 1080,
  reservedTop: 0, reservedBottom: 0, reservedLeft: 0, reservedRight: 0 }, mon || {}) },
  windows: Object.fromEntries(windows.map((w) => [w.id, w])) });
const run = (sim, seconds) => { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) Sim.step(sim, 1 / 60); };
const total = (sim) => sim.surfaces.reduce((t, s) => t + Bank.totalDepth(s.bank) * s.bank.segmentWidth, 0);
const surf = (sim, id) => sim.surfaces.find((s) => s.id === id);

// ---- 1. snow lands on windows and on the ground ----------------------------
test("snow accumulates on a floating window top and on the ground", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 400, 300, 700, 420, { floating: true })]), "M");
  run(sim, 90);
  const w = surf(sim, "window:a").bank, g = surf(sim, "ground:M").bank;
  assert.ok(Bank.totalDepth(w) > 200, "window bank must hold snow: " + Bank.totalDepth(w));
  assert.ok(Bank.totalDepth(g) > 200, "ground bank must hold snow: " + Bank.totalDepth(g));
  assert.ok(sim.bankRevision > 20, "bank revision must advance so renderers repaint");
});

test("accumulation is visible within a minute at default density", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 400, 300, 700, 420, { floating: true })]), "M");
  run(sim, 60);
  const w = surf(sim, "window:a").bank;
  const avg = Bank.totalDepth(w) / w.segments;
  assert.ok(avg > 2.5, "average depth after 60 s should be a few pixels, got " + avg.toFixed(2));
});

// ---- 2. snow falls visibly in front of windows -----------------------------
test("a share of flakes never settles, so they keep falling over window bodies", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 0, 40, 1920, 1000)]), "M");
  const s = sim.system; let settle = 0, pass = 0;
  for (let i = 0; i < s.count; i++) (s.settle[i] ? settle++ : pass++);
  assert.ok(settle > 0 && pass > 0, `both kinds must exist (settle=${settle}, pass=${pass})`);
  // a pass-through flake crossing the window top must not land
  const i = (() => { for (let k = 0; k < s.count; k++) if (!s.settle[k]) return k; })();
  s.x[i] = 500; s.y[i] = 38; s.r[i] = 1;
  const hit = Col.landingSurface(Bank, sim.surfaces, s, i, 500, 40.5, 1, 2);
  assert.equal(hit, null);
});

// ---- 3. headroom / occlusion (no snow over other windows or the panel) ------
test("snow never rises into the panel above a window", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 10, 46, 900, 1000)], { reservedTop: 36 }), "M");
  const b = surf(sim, "window:a").bank;
  // 46 - 36 - 1 margin = 9 px of free space
  assert.ok(Math.max.apply(null, Array.from(b.limit)) <= 9.0001);
  assert.ok(b.limit[10] > 8);
});

test("a window covered by one in front gets no snow on the hidden stretch", () => {
  const sim = makeSim();
  const back = win("back", 100, 200, 600, 400, { floating: true, focusRank: 5 });
  const front = win("front", 300, 100, 200, 500, { floating: true, focusRank: 0 });
  Sim.setGeometry(sim, geo([back, front]), "M");
  const b = surf(sim, "window:back").bank;
  const at = (x) => b.limit[Bank.indexAt(b, x)];
  assert.equal(at(400), 0, "top edge hidden behind the front window");
  assert.ok(at(150) > 10, "exposed stretch keeps full headroom");
  const f = surf(sim, "window:front").bank;
  assert.ok(f.limit[Bank.indexAt(f, 400)] > 10, "front window is never hidden by the one behind");
});

test("ground under a window is not landable and gaps keep only their headroom", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 0, 0, 960, 1070), win("b", 960, 0, 960, 1080)]), "M");
  const g = surf(sim, "ground:M").bank;
  assert.equal(g.limit[Bank.indexAt(g, 1500)], 0, "window touches the ground line");
  const gap = g.limit[Bank.indexAt(g, 400)];
  assert.ok(gap > 7 && gap < 10, "10 px gap under the window: " + gap);
});

test("existing snow is clamped when a window moves in front of it", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 400, 300, 700, 420, { floating: true, focusRank: 5 })]), "M");
  run(sim, 60);
  const before = Bank.totalDepth(surf(sim, "window:a").bank);
  assert.ok(before > 0);
  Sim.setGeometry(sim, geo([win("a", 400, 300, 700, 420, { floating: true, focusRank: 5 }),
    win("cover", 300, 200, 1000, 400, { floating: true, focusRank: 0 })]), "M");
  assert.equal(Bank.totalDepth(surf(sim, "window:a").bank), 0);
});

// ---- 4. wind no longer builds a pillar at the edge --------------------------
test("wind drift does not pile all snow into a pillar at the downwind end", () => {
  const sim = makeSim({ wind: 1 });
  Sim.setGeometry(sim, geo([win("a", 400, 300, 700, 420, { floating: true })]), "M");
  run(sim, 300);
  const b = surf(sim, "window:a").bank;
  const last = b.heights[b.segments - 1];
  let sum = 0; for (let i = 0; i < b.segments - 1; i++) sum += b.heights[i];
  const mean = sum / (b.segments - 1);
  assert.ok(last <= Math.max(mean * 1.6, 8), `edge ${last.toFixed(1)} vs mean ${mean.toFixed(1)}`);
});

// ---- 5. Hyprland arrays are QVariantList, not Array --------------------------
test("reservedArea reads array-like objects (QVariantList), not only Arrays", () => {
  const arrayLike = { 0: 0, 1: 36, 2: 0, 3: 12, length: 4 };
  const r = DisplayMath.reservedArea(arrayLike, 1);
  assert.equal(r.top, 36); assert.equal(r.bottom, 12);
  assert.equal(DisplayMath.reservedArea(null, 1).top, 0);
  assert.equal(DisplayMath.reservedArea([0, 36, 0, 12], 2).top, 18);
});

// ---- 6. settings: layer default and one-time migration -----------------------
test("default layer is above; stored legacy 'behind' migrates once, a deliberate choice sticks", () => {
  assert.equal(Settings.normalize({}).layer, "above");
  assert.equal(Settings.normalize({ id: "snowglobe", layer: "behind" }).layer, "above");
  const chosen = Settings.toEntry({ layer: "behind" }, "snowglobe");
  assert.equal(chosen.settingsRevision, Settings.SETTINGS_REVISION);
  assert.equal(Settings.normalize(chosen).layer, "behind");
  assert.equal(Settings.toEntry(Settings.normalize({ layer: "behind" }), "snowglobe").layer, "above");
});

// ---- 7. window geometry carries stacking hints -------------------------------
test("geometry model keeps focus rank and special flag", () => {
  const st = WG.createState();
  WG.update(st, { monitors: [], windows: [{ id: "w", monitorName: "M", x: 0, y: 0, width: 5, height: 5, special: true, focusRank: 3 }] }, 1 / 60);
  assert.equal(st.windows.w.special, true); assert.equal(st.windows.w.focusRank, 3);
  const changed = WG.update(st, { monitors: [], windows: [{ id: "w", monitorName: "M", x: 0, y: 0, width: 5, height: 5, special: true, focusRank: 0 }] }, 1 / 60);
  assert.equal(changed, true, "a focus change reorders windows and must be noticed");
});

// ---- 8. bank primitives ------------------------------------------------------
test("scoop removes exactly the area it reports and respects the brush", () => {
  const b = Bank.create("x", "window", 0, 100, 200, 2, 50);
  for (let i = 0; i < b.segments; i++) b.heights[i] = 10;
  const before = Bank.totalDepth(b) * 2;
  const got = Bank.scoop(b, 100, 95, 20, 1, 0);
  assert.ok(got > 0);
  assert.ok(Math.abs((before - Bank.totalDepth(b) * 2) - got) < 1e-3);
  assert.equal(b.heights[5], 10, "segments outside the brush are untouched");
  assert.equal(Bank.scoop(b, 100, 400, 20, 1, 0), 0, "a brush far below the snow gathers nothing");
  assert.ok(Bank.scoop(b, 100, 95, 20, 1, 5) <= 5 + 1e-6, "maxArea is a hard cap");
});

test("giveBack is bounded by the limits and never creates snow", () => {
  const b = Bank.create("x", "window", 0, 100, 200, 2, 50);
  const given = Bank.giveBack(b, 100, 100, 8);
  assert.ok(given > 0 && given <= 100 + 1e-3);
  Bank.applyLimits(b, new Float32Array(b.segments)); // everything covered
  assert.equal(Bank.totalDepth(b), 0);
  assert.equal(Bank.giveBack(b, 100, 100, 8), 0);
});

// ---- 9. simulation gather / return conserve snow -----------------------------
test("gather then returnSnow conserves snow (within the bank limits)", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([win("a", 400, 300, 700, 420, { floating: true })]), "M");
  run(sim, 120);
  const before = total(sim);
  const area = Sim.gather(sim, 700, 296, 30, 0.5, 0);
  assert.ok(area > 0);
  assert.ok(Math.abs(before - total(sim) - area) < 1e-3);
  const back = Sim.returnSnow(sim, 700, 296, area);
  assert.ok(back > 0 && back <= area + 1e-3);
});

// ---- 10. SnowRoll -------------------------------------------------------------
test("ball radius grows gradually with distance rolled over snow and is capped", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([]), "M");
  run(sim, 200);
  const gather = (cx, cy, br, amt, max) => Sim.gather(sim, cx, cy, br, amt, max);
  const roll = Roll.create(200, 1075);
  const radii = [];
  for (let k = 0; k < 400; k++) {
    Roll.move(roll, 200 + 60 * Math.cos(k / 6), 1075 + 8 * Math.sin(k / 6), gather);
    if (k % 50 === 49) radii.push(Roll.radiusFor(roll.area));
  }
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i] >= radii[i - 1] - 1e-9, "never shrinks");
  assert.ok(radii[radii.length - 1] > Roll.MIN_RADIUS, "circular scrubbing builds a real ball");
  assert.ok(radii[radii.length - 1] <= Roll.MAX_RADIUS + 1e-9, "capped");
  assert.ok(radii[0] < radii[radii.length - 1], "growth is gradual, not instant");
});

test("a fast flick cannot skip over snow (path is stamped in steps)", () => {
  const stamps = [];
  const roll = Roll.create(0, 0);
  Roll.move(roll, 400, 0, (cx) => { stamps.push(cx); return 0; });
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] <= Roll.BRUSH_MIN * 0.5 + 1e-9);
});

test("moving over empty space gathers nothing and reports a stall", () => {
  const roll = Roll.create(0, 0);
  for (let i = 1; i <= 10; i++) Roll.move(roll, i * 20, 0, () => 0);
  assert.equal(roll.area, 0); assert.equal(roll.stalled, 10);
});

// ---- 11. stacking -------------------------------------------------------------
test("a dropped ball stacks on the top of a nearby snowman, smaller than the one below", () => {
  const m = Model.create("s", "M", 100, 500, 0); Model.addBall(m, 100, 500, 40);
  let t = Model.stackTarget([m], "M", 104, 420, 25);
  assert.ok(t && t.index === 0);
  Model.addStackedBall(m, 0, 0, 0, Model.stackRadius(m.balls[0], 50));
  assert.ok(m.balls[1].r <= 40 * Model.STACK_MAX_RATIO + 1e-9);
  t = Model.stackTarget([m], "M", 100, 500, 25);
  assert.equal(t.index, 1, "walks up to the free top of the stack");
  assert.equal(Model.stackTarget([m], "M", 900, 500, 25), null);
  assert.equal(Model.stackTarget([m], "OTHER", 100, 500, 25), null, "other monitors are ignored");
});
