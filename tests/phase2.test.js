// Focused tests for Phase 2 — natural snowball rolling.
// Run with: node --test tests/phase2.test.js
//
// These exercise the pure JS models only. They do not claim any visual or QML
// verification; the QML harness needs PySide6, which is not installed here.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = (f) => require(path.join(__dirname, "..", "js", f));

const Bank = js("SnowBank.js"), Col = js("Collision.js"), PS = js("ParticleSystem.js"),
  Sim = js("Simulation.js"), Roll = js("SnowRoll.js"), Tracks = js("SnowTracks.js"),
  MU = js("MathUtils.js"), C = js("Constants.js");

const W = 800, H = 500, GROUND_Y = 480, SEG = C.SEGMENT_WIDTH;

function makeSim(overrides) {
  const random = MU.createRandom(MU.hashSeed("P2"));
  const system = PS.create(C.MAX_PARTICLES.balanced, random);
  system.width = W; system.height = H;
  const det = PS.create(C.MAX_DETACHED, random);
  det.width = W; det.height = H;
  const cfg = {
    system, particleSystem: PS, random,
    stepSeconds: C.STEP_SECONDS, maxStepsPerFrame: 5, maxBacklogSeconds: 0.25,
    capacities: C.MAX_PARTICLES,
    // No steady snowfall in these tests: only the roll moves snow.
    density: 0, wind: 0, quality: "balanced", adaptiveScale: 1,
    bankModule: Bank, collisionModule: Col, detachedSystem: det,
    rollModule: Roll, tracksModule: Tracks, maxTracks: C.ROLL_TRACK_CAPACITY,
    slideSpeed: C.WINDOW_SLIDE_SPEED, detachSpeed: C.WINDOW_DETACH_SPEED,
    windowSlideAmount: C.WINDOW_SLIDE_AMOUNT, detachMass: C.WINDOW_DETACH_MASS,
    detachMaxPerEvent: C.WINDOW_DETACH_MAX_PER_EVENT,
    velocityInherit: C.WINDOW_VELOCITY_INHERIT,
    detachedGravity: C.DETACHED_GRAVITY, detachedLift: C.DETACHED_LIFT,
    accumulateOnWindows: true, maxSurfaces: 96,
    depositAmount: C.DEPOSIT_AMOUNT, depositSpread: C.DEPOSIT_SPREAD,
    settleSteps: C.BANK_SETTLE_STEPS,
    // Freeze bank settling so mass-transfer assertions are exact.
    slideAmount: 0, redistributeAmount: 0, erodeAmount: 0,
    segmentWidth: SEG, windowMaxDepth: C.WINDOW_MAX_DEPTH,
    groundMaxDepth: C.GROUND_MAX_DEPTH
  };
  Object.assign(cfg, overrides || {});
  return Sim.create(cfg);
}

function geo(windows) {
  const monitors = { M: { name: "M", x: 0, y: 0, width: W, height: H,
    reservedTop: 0, reservedBottom: 0, reservedLeft: 0, reservedRight: 0 } };
  const list = (windows || []).map((w) => Object.assign({ monitorName: "M", fullscreen: false,
    floating: true, special: false, focusRank: 0, hasMoved: false, speed: 0 }, w));
  return { monitors, windows: Object.fromEntries(list.map((w) => [w.id, w])) };
}

const surf = (sim, id) => sim.surfaces.find((s) => s.id === id);
const mass = (sim) => sim.surfaces.reduce((t, s) => t + Bank.totalDepth(s.bank) * s.bank.segmentWidth, 0);
const fill = (bank, from, to, depth) => {
  for (let x = from; x <= to; x += SEG) Bank.deposit(bank, x, depth, 0);
};
const steps = (sim, n) => { for (let i = 0; i < n; i++) Sim.step(sim, 1 / 60); };

// ---- 1. pointer target, acceleration and deceleration -----------------------
test("the ball eases toward the pointer instead of snapping to it", () => {
  const r = Roll.create(0, 0);
  Roll.setTarget(r, 120, 0);
  const gather = () => 0, fx = [];
  Roll.advance(r, 1 / 60, gather, fx);
  assert.ok(r.x > 0 && r.x < 10, "first step moves a little, not all the way: " + r.x);
  assert.ok(r.vx > 0, "velocity ramps up from rest");
  const firstV = r.vx;
  Roll.advance(r, 1 / 60, gather, fx);
  assert.ok(r.vx > firstV, "still accelerating while far from the target");
  for (let i = 0; i < 60; i++) Roll.advance(r, 1 / 60, gather, fx);
  assert.ok(Math.abs(r.x - 120) < 1e-6, "settles exactly on the pointer: " + r.x);
  assert.equal(r.vx, 0, "and comes to rest");
});

test("a fast flick is capped so the swept brush cannot skip snow", () => {
  const r = Roll.create(0, 0);
  Roll.setTarget(r, 100000, 0);
  Roll.advance(r, 1 / 60, () => 0, []);
  assert.ok(Math.abs(r.vx) <= Roll.MAX_ROLL_SPEED + 1e-6);
  assert.ok(r.x <= Roll.MAX_ROLL_SPEED * (1 / 60) + 1e-6);
});

// ---- 2. rotation follows travel distance, not pointer event count -----------
test("spin depends on distance travelled, not on how many moves were issued", () => {
  const a = Roll.create(0, 0), b = Roll.create(0, 0);
  Roll.move(a, 100, 0, () => 0);
  for (let i = 1; i <= 10; i++) Roll.move(b, i * 10, 0, () => 0);
  assert.ok(Math.abs(a.spin - b.spin) < 1e-9, `${a.spin} vs ${b.spin}`);
  assert.ok(Math.abs(a.travel - 100) < 1e-9);
});

// ---- 3. progressive growth, compaction and the existing size cap -----------
test("area grows monotonically, compaction increases, and radius stays capped", () => {
  const r = Roll.create(400, 470);
  let previous = r.area, previousCompaction = r.compaction;
  Roll.setTarget(r, 100000, 470); // keep rolling; the speed cap bounds each step
  for (let i = 0; i < 240; i++) {
    Roll.advance(r, 1 / 60, () => 20, []); // generous pile
    assert.ok(r.area >= previous, "area never shrinks while gathering");
    assert.ok(Roll.radiusFor(r.area) <= Roll.MAX_RADIUS + 1e-9);
    assert.ok(Roll.visibleRadius(r) <= Math.max(5, Roll.radiusFor(r.area)) + 1e-9);
    assert.ok(r.compaction >= previousCompaction);
    previous = r.area; previousCompaction = r.compaction;
  }
  assert.ok(Roll.isFull(r), "a long enough roll reaches the model's maximum size");
  assert.ok(Math.abs(Roll.radiusFor(r.area) - Roll.MAX_RADIUS) < 1e-6);
  assert.ok(r.compaction > 0.9, "a well-rolled ball is visibly compacted");
});

// ---- 4. press, hold, move, release with real mass transfer ------------------
test("press-hold-move-release transfers exactly the collected bank mass", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([]), "M");
  const ground = surf(sim, "ground:M").bank;
  fill(ground, 60, 740, 14);
  const before = mass(sim);

  const r = Sim.beginRoll(sim, 200, GROUND_Y - 7);
  assert.ok(r && r.area > 0, "pressing on a pile gathers snow immediately");
  const atPress = r.area;

  Sim.setRollTarget(sim, 600, GROUND_Y - 7);
  steps(sim, 120);
  assert.equal(Sim.rollState(sim), r, "the simulation owns the same roll object");
  assert.ok(r.area > atPress, "holding and moving progressively grows the ball");
  assert.ok(r.x > 300, "the ball actually travelled across the pile");

  const lost = before - mass(sim);
  assert.ok(Math.abs(lost - r.area) < 1e-3,
    `bank lost ${lost.toFixed(3)} but ball collected ${r.area.toFixed(3)}`);

  const taken = Sim.takeRoll(sim);
  assert.equal(taken, r, "release hands the same object back to the builder");
  assert.equal(Sim.rollState(sim), null, "and the simulation no longer holds it");
  assert.ok(Roll.ready(taken), "the finished ball is large enough to place");
});

test("release sweeps the final leg so the ball ends at the pointer", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([]), "M");
  fill(surf(sim, "ground:M").bank, 40, 760, 14);
  const before = mass(sim);

  const r = Sim.beginRoll(sim, 100, GROUND_Y - 7);
  Sim.setRollTarget(sim, 700, GROUND_Y - 7);
  steps(sim, 2); // only two physics ticks: the ball is still far behind
  assert.ok(r.x < 300, "the eased ball lags behind a fast flick: " + r.x);

  const done = Sim.finishRoll(sim);
  assert.equal(done, r);
  assert.ok(Math.abs(r.x - 700) < 1e-6, "release places it at the pointer: " + r.x);
  assert.equal(r.vx, 0);
  assert.equal(Sim.rollState(sim), null);
  assert.ok(Math.abs((before - mass(sim)) - r.area) < 1e-3,
    "the swept final leg collects, but does not duplicate, snow");
});

// ---- 5. circular collection across surfaces and pile shapes ----------------
test("one roll gathers from a window bank and a ground bank of different depths", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([{ id: "w", x: 80, y: 180, width: 240, height: 120 }]), "M");
  const win = surf(sim, "window:w").bank, ground = surf(sim, "ground:M").bank;
  fill(win, 100, 300, 6);          // shallow window drift
  fill(ground, 300, 600, 18);      // deeper ground pile
  const beforeWin = Bank.totalDepth(win) * SEG;
  const beforeGround = Bank.totalDepth(ground) * SEG;

  const r = Sim.beginRoll(sim, 150, 178);
  assert.ok(r.area > 0, "starts on the window-top snow");
  Sim.setRollTarget(sim, 450, GROUND_Y - 9);
  steps(sim, 150);

  assert.ok(beforeWin - Bank.totalDepth(win) * SEG > 0, "window snow was collected");
  assert.ok(beforeGround - Bank.totalDepth(ground) * SEG > 0, "ground snow was collected");
  const lost = (beforeWin + beforeGround) - mass(sim);
  assert.ok(Math.abs(lost - r.area) < 1e-3, `lost ${lost} vs area ${r.area}`);
});

// ---- 6. contact effects: tracks and cosmetic dust never duplicate snow ------
test("rolling stamps fading tracks and scatters decorative, non-settling flakes", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([]), "M");
  fill(surf(sim, "ground:M").bank, 40, 760, 16);
  const before = mass(sim);

  const r = Sim.beginRoll(sim, 120, GROUND_Y - 8);
  Sim.setRollTarget(sim, 700, GROUND_Y - 8);
  steps(sim, 90);

  assert.ok(sim.tracks.count > 0, "pressed tracks were left in the snow");
  assert.ok(sim.detachedSystem.count > 0, "contact dust was emitted");
  for (let i = 0; i < sim.detachedSystem.count; i++)
    assert.equal(sim.detachedSystem.settle[i], 0, "dust never deposits into a bank");
  assert.ok(Math.abs((before - mass(sim)) - r.area) < 1e-3,
    "dust did not create or destroy bank mass");

  Sim.takeRoll(sim);
  steps(sim, 240);
  assert.equal(sim.tracks.count, 0, "tracks fade away and are buried over time");
});

// ---- 7. interrupted interactions still return their snow --------------------
test("takeRoll preserves collected area and returnSnow gives it back", () => {
  const sim = makeSim();
  Sim.setGeometry(sim, geo([]), "M");
  fill(surf(sim, "ground:M").bank, 100, 700, 12);
  const before = mass(sim);

  const r = Sim.beginRoll(sim, 250, GROUND_Y - 6);
  Sim.setRollTarget(sim, 500, GROUND_Y - 6);
  steps(sim, 60);
  const collected = r.area;
  const taken = Sim.takeRoll(sim);
  assert.equal(taken, r);
  assert.equal(taken.area, collected, "an interrupted gesture keeps every unit collected");
  assert.ok(collected > 0);

  const returned = Sim.returnSnow(sim, taken.x, taken.y, collected);
  assert.ok(returned > 0, "the snow goes back to the pile instead of vanishing");
  assert.ok(returned <= collected + 1e-3, "and never creates snow");
  assert.ok(mass(sim) >= before - collected - 1e-3);
});

// ---- 8. bounded track store -------------------------------------------------
test("the track store is bounded and clears completely", () => {
  const t = Tracks.create(4);
  for (let i = 0; i < 10; i++) Tracks.stamp(t, i * 10, 100, 5, 0.6);
  assert.ok(t.count <= 4);
  // update() clamps dt to 0.1 s per call, so drive several real frames.
  for (let i = 0; i < 100; i++) Tracks.update(t, 0.1, Tracks.FADE_PER_SECOND, 0);
  assert.equal(t.count, 0);
  Tracks.stamp(t, 0, 0, 4, 0.5);
  Tracks.clear(t);
  assert.equal(t.count, 0);
});

// ---- 9. decorative injection and removal keep typed arrays consistent -------
test("inject honours settle=0 and remove swaps slots without holes", () => {
  const p = PS.create(8, MU.createRandom(1));
  const a = PS.inject(p, 10, 20, 1, 2, 1.5, 0.4, 0, 0);
  const b = PS.inject(p, 30, 40, 2, 3, 2.5, 0.5, 1); // defaults to settling
  assert.equal(p.settle[a], 0);
  assert.equal(p.settle[b], 1);
  PS.remove(p, a);
  assert.equal(p.count, 1);
  assert.equal(p.x[0], 30, "the last slot was swapped into the removed index");
  assert.equal(p.settle[0], 1);
});
