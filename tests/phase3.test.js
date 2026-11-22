// Phase 3 tests: tiered, mass-conserving snow response to moving windows.
// Run with: node --test tests/phase3.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = (f) => require(path.join(__dirname, "..", "js", f));

const Bank = js("SnowBank.js"), Col = js("Collision.js"), PS = js("ParticleSystem.js"),
  Sim = js("Simulation.js"), MU = js("MathUtils.js"), C = js("Constants.js");

function makeSim(overrides) {
  const o = overrides || {};
  const random = MU.createRandom(MU.hashSeed("W"));
  const system = PS.create(C.MAX_PARTICLES.high, random); system.width = 1920; system.height = 1080;
  const det = PS.create(C.MAX_DETACHED, random); det.width = 1920; det.height = 1080;
  const sim = Sim.create({
    system, particleSystem: PS, random, stepSeconds: C.STEP_SECONDS, maxStepsPerFrame: 5,
    maxBacklogSeconds: 0.25, capacities: C.MAX_PARTICLES, density: 1, wind: 0,
    quality: "balanced", adaptiveScale: 1, bankModule: Bank, collisionModule: Col, detachedSystem: det,
    slideSpeed: C.WINDOW_SLIDE_SPEED, detachSpeed: C.WINDOW_DETACH_SPEED,
    windowSlideAmount: o.windowSlideAmount === undefined ? C.WINDOW_SLIDE_AMOUNT : o.windowSlideAmount,
    detachMass: o.detachMass === undefined ? C.WINDOW_DETACH_MASS : o.detachMass,
    detachMaxPerEvent: o.detachMaxPerEvent === undefined ? 1 : o.detachMaxPerEvent,
    velocityInherit: o.velocityInherit === undefined ? C.WINDOW_VELOCITY_INHERIT : o.velocityInherit,
    detachedGravity: C.DETACHED_GRAVITY, detachedLift: C.DETACHED_LIFT,
    mediumDepth: C.WINDOW_MEDIUM_DEPTH, heavyDepth: C.WINDOW_HEAVY_DEPTH,
    mediumMass: C.WINDOW_MEDIUM_MASS, heavyMass: C.WINDOW_HEAVY_MASS,
    chunkChance: o.chunkChance === undefined ? C.WINDOW_CHUNK_CHANCE : o.chunkChance,
    shedKick: o.shedKick === undefined ? C.WINDOW_SHED_KICK : o.shedKick,
    accumulateOnWindows: true, maxSurfaces: 96, depositAmount: C.DEPOSIT_AMOUNT,
    depositSpread: C.DEPOSIT_SPREAD, settleSteps: C.BANK_SETTLE_STEPS,
    slideAmount: o.slideAmount === undefined ? C.BANK_SLIDE_AMOUNT : o.slideAmount,
    redistributeAmount: C.BANK_REDISTRIBUTE_AMOUNT, erodeAmount: 0,
    segmentWidth: C.SEGMENT_WIDTH, windowMaxDepth: 255, groundMaxDepth: 255
  });
  if (o.random !== undefined) sim.random = o.random;
  return sim;
}

// A standalone surface with a bank filled to a fixed depth (or a profile fn).
function surface(id, type, x, y, width, fill) {
  const bank = Bank.create(id, type, x, y, width, C.SEGMENT_WIDTH, 255);
  for (let i = 0; i < bank.segments; i++) bank.heights[i] = typeof fill === "function" ? fill(i, bank.segments) : fill;
  return { id, type, x, y, width, bank };
}

const winObj = (dx, vx, vy, speed) => ({ dx, vx, vy, speed, hasMoved: true });
const carried = (d) => { let m = 0; for (let i = 0; i < d.count; i++) m += d.mass[i]; return m; };
const approx = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 0.01 : eps);
const bankArea = (bank) => Bank.totalDepth(bank) * bank.segmentWidth;

// ---- 1. the duplicate-slideAmount bug is fixed -----------------------------
test("windowSlideAmount is kept distinct from the bank settle slideAmount", () => {
  const sim = makeSim({ windowSlideAmount: 3.7, slideAmount: 0.05 });
  assert.equal(sim.windowSlideAmount, 3.7, "window slide must keep its configured value");
  assert.equal(sim.slideAmount, 0.05, "bank settle keeps its own value");
  const def = makeSim();
  assert.equal(def.windowSlideAmount, C.WINDOW_SLIDE_AMOUNT);
});

test("the configured windowSlideAmount actually shifts snow (behavioural)", () => {
  // Snow only on the right half; moving right means trailing edge is the left.
  const big = makeSim({ windowSlideAmount: 4, slideAmount: 0.01, detachMaxPerEvent: 0 });
  const s = surface("w", "window", 0, 300, 400, (i, n) => i >= n / 2 ? 6 : 0);
  const com = (b) => { let m = 0, s = 0; for (let i = 0; i < b.segments; i++) { m += b.heights[i]; s += i * b.heights[i]; } return s / m; };
  const before = com(s.bank);
  Sim.applyWindowMovement(big, winObj(50, 100, 0, 100), s);
  const after = com(s.bank);
  assert.ok(after < before - 0.3, "snow must creep toward the left/trailing edge, " + before + " -> " + after);
});

// ---- 2. rigid below the slide threshold ------------------------------------
test("snow rides rigidly below the slide threshold", () => {
  const sim = makeSim();
  const s = surface("w", "window", 0, 300, 400, 4);
  const before = Bank.totalDepth(s.bank);
  Sim.applyWindowMovement(sim, winObj(10, 30, 0, 30), s);
  assert.equal(Bank.totalDepth(s.bank), before, "no slide or shed below slideSpeed");
  assert.equal(sim.detachedSystem.count, 0);
});

// ---- 3. light snow sheds one flake carrying exact area ---------------------
test("light snow sheds a single independent flake with exact transferred mass", () => {
  const sim = makeSim({ random: () => 0.5, detachMaxPerEvent: 1 });
  const s = surface("w", "window", 0, 300, 400, 3); // light: < mediumDepth, >= detachMass
  const before = bankArea(s.bank);
  Sim.applyWindowMovement(sim, winObj(50, 200, 0, 200), s);
  const loss = before - bankArea(s.bank);
  const d = sim.detachedSystem;
  assert.equal(d.count, 1, "one light flake");
  assert.equal(d.type[0], 0, "light tier");
  assert.ok(d.r[0] < 1.7, "small flake");
  assert.ok(approx(loss, d.mass[0]), "exactly the removed area is carried: " + loss + " vs " + d.mass[0]);
  assert.ok(approx(sim.detachedArea, loss));
  assert.ok(d.vr[0] !== 0 && Math.abs(d.vr[0]) <= 14.001, "gentle tumble for light snow");
});

// ---- 4. medium snow breaks into rotating clusters --------------------------
test("medium snow splits into two rotating pieces with conserved mass", () => {
  const sim = makeSim({ random: () => 0.5, detachMaxPerEvent: 1 });
  const s = surface("w", "window", 0, 300, 400, 8); // medium depth
  const before = bankArea(s.bank);
  Sim.applyWindowMovement(sim, winObj(50, 200, 0, 200), s);
  const loss = before - bankArea(s.bank);
  const d = sim.detachedSystem;
  assert.equal(d.count, 2, "medium cluster splits in two");
  assert.equal(d.type[0], 1); assert.equal(d.type[1], 1);
  assert.ok(Math.abs(d.vr[0]) === 48 && Math.abs(d.vr[1]) === 48, "visible tumble");
  assert.ok(approx(carried(d), loss), "both pieces together carry exactly the removed area");
});

// ---- 5. heavy snow slides then breaks into chunks, probabilistically -------
test("heavy snow only breaks when the chunk roll succeeds", () => {
  const never = makeSim({ random: () => 0.5, chunkChance: 0, detachMaxPerEvent: 1 });
  const s1 = surface("w", "window", 0, 300, 400, 20);
  Sim.applyWindowMovement(never, winObj(50, 200, 0, 200), s1);
  assert.equal(never.detachedSystem.count, 0, "heavy bank holds, only slides");

  const always = makeSim({ random: () => 0.5, chunkChance: 1, detachMaxPerEvent: 1 });
  const s2 = surface("w", "window", 0, 300, 400, 20);
  const before = bankArea(s2.bank);
  Sim.applyWindowMovement(always, winObj(50, 200, 0, 200), s2);
  const loss = before - bankArea(s2.bank);
  const d = always.detachedSystem;
  assert.equal(d.count, 3, "heavy bank breaks into three chunks");
  assert.equal(d.type[0], 2);
  assert.ok(d.r[0] > 3, "large chunk");
  assert.ok(Math.abs(d.vr[0]) === 30, "slow heavy roll");
  assert.ok(approx(carried(d), loss), "chunks carry exactly the removed area");
});

// ---- 6. velocity inheritance + rotation -----------------------------------
test("detached snow inherits window velocity and tumbles while falling", () => {
  const sim = makeSim({ random: () => 0.5, shedKick: 0, velocityInherit: 0.5, detachMaxPerEvent: 1 });
  const s = surface("w", "window", 0, 300, 400, 3);
  Sim.applyWindowMovement(sim, winObj(50, 200, 40, 200), s);
  const d = sim.detachedSystem;
  assert.equal(d.count, 1);
  assert.ok(approx(d.vx[0], 200 * 0.5), "inherits horizontal velocity");
  assert.ok(approx(d.vy[0], 40 * 0.5 - C.DETACHED_LIFT - 0.5 * 8), "inherits vy plus lift");

  const rot0 = d.rot[0], vr = d.vr[0], y0 = d.y[0];
  for (let k = 0; k < 6; k++) Sim.stepDetached(sim, 1 / 60);
  assert.ok(approx(d.rot[0], rot0 + vr * 6 / 60, 0.5), "rotation integrates from vr");
  assert.ok(d.y[0] !== y0, "chunk falls");
});

// ---- 7. shed -> flight -> landing conserves mass --------------------------
test("shed snow lands back on a bank without creating or losing mass", () => {
  const sim = makeSim({ random: () => 0.5, shedKick: 0, velocityInherit: 0, detachMaxPerEvent: 1 });
  const w = surface("w", "window", 600, 300, 400, 3);
  const g = surface("ground:M", "ground", 0, 1080, 1920, 0);
  sim.surfaces = [w, g];

  const totalBefore = bankArea(w.bank) + bankArea(g.bank);
  Sim.applyWindowMovement(sim, winObj(50, 200, 0, 200), w);
  const d = sim.detachedSystem;
  assert.ok(d.count > 0);
  const flightLoad = carried(d);
  const loss = totalBefore - (bankArea(w.bank) + bankArea(g.bank));
  assert.ok(approx(loss, flightLoad), "window loss equals area carried in flight");

  for (let k = 0; k < 600 && d.count > 0; k++) Sim.stepDetached(sim, 1 / 60);
  assert.equal(d.count, 0, "chunk landed");
  const totalAfter = bankArea(w.bank) + bankArea(g.bank);
  assert.ok(approx(totalAfter, totalBefore, 0.05),
    "total bank mass conserved across shed + fall + land: " + totalBefore + " -> " + totalAfter);
  assert.ok(approx(sim.landedArea, flightLoad, 0.05), "all carried area was deposited on landing");
});

// ---- 8. falling snow accumulates on another surface with its exact load ----
test("a falling chunk deposits exactly its carried area on the ground", () => {
  const sim = makeSim({ random: () => 0.5 });
  const g = surface("ground:M", "ground", 0, 1080, 1920, 0);
  sim.surfaces = [g];
  const d = sim.detachedSystem;
  const load = 12.5;
  PS.inject(d, 400, 1040, 0, 60, 2, 0.8, 2, 1, load);
  const before = bankArea(g.bank);
  for (let k = 0; k < 200 && d.count > 0; k++) Sim.stepDetached(sim, 1 / 60);
  assert.equal(d.count, 0);
  const gain = bankArea(g.bank) - before;
  assert.ok(approx(gain, load, 0.05), "ground gained exactly the carried area: " + gain);
  assert.ok(approx(sim.landedArea, gain, 0.05));
});

// ---- 9. decorative dust never deposits ------------------------------------
test("settle=0 detached dust falls past surfaces without depositing", () => {
  const sim = makeSim({ random: () => 0.5 });
  const g = surface("ground:M", "ground", 0, 1080, 1920, 0);
  sim.surfaces = [g];
  const d = sim.detachedSystem;
  PS.inject(d, 400, 1040, 0, 60, 1, 0.8, 0, 0, 0); // settle=0, no carried mass
  assert.equal(d.settle[0], 0);
  for (let k = 0; k < 30; k++) Sim.stepDetached(sim, 1 / 60);
  assert.ok(approx(bankArea(g.bank), 0), "no mass deposited by decorative dust");
});
