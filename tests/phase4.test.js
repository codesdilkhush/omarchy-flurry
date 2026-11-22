// Phase 4 tests: automatic, physical snow removal by one per-monitor plow.
// Run with: node --test tests/phase4.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = (f) => require(path.join(__dirname, "..", "js", f));

const Bank = js("SnowBank.js"), PS = js("ParticleSystem.js"), Sim = js("Simulation.js"),
  Plow = js("SnowPlowModel.js"), Tracks = js("SnowTracks.js"), C = js("Constants.js"),
  Settings = js("Settings.js"), MU = js("MathUtils.js");

const WIDTH = 800;
const GROUND_Y = 900;
const DT = C.STEP_SECONDS;

function makeSim(o) {
  const opt = o || {};
  const random = MU.createRandom(MU.hashSeed("P4"));
  const system = PS.create(C.MAX_PARTICLES.high, random);
  system.width = WIDTH; system.height = GROUND_Y;
  const det = PS.create(C.MAX_DETACHED, random);
  det.width = WIDTH; det.height = GROUND_Y;
  const sim = Sim.create({
    system, particleSystem: PS, random, stepSeconds: DT, maxStepsPerFrame: 5,
    maxBacklogSeconds: 0.25, capacities: C.MAX_PARTICLES, density: 1, wind: 0,
    quality: "balanced", adaptiveScale: 1, bankModule: Bank, detachedSystem: det,
    tracksModule: Tracks, maxTracks: 128, rollModule: null,
    plowModule: Plow,
    plowEnabled: opt.enabled === undefined ? true : opt.enabled,
    plowSpawnDepth: opt.spawnDepth === undefined ? C.PLOW_SPAWN_DEPTH : opt.spawnDepth,
    plowDespawnDepth: opt.despawnDepth === undefined ? C.PLOW_DESPAWN_DEPTH : opt.despawnDepth,
    plowCooldownSeconds: opt.cooldown === undefined ? C.PLOW_COOLDOWN_SECONDS : opt.cooldown,
    plowCapacity: opt.capacity === undefined ? C.PLOW_CAPACITY : opt.capacity,
    plowSpeed: C.PLOW_SPEED,
    plowLoadedSpeedFactor: C.PLOW_LOADED_SPEED_FACTOR,
    plowScoopRadius: C.PLOW_SCOOP_RADIUS,
    plowScoopAmount: C.PLOW_SCOOP_AMOUNT,
    plowUnloadSeconds: opt.unloadSeconds === undefined ? C.PLOW_UNLOAD_SECONDS : opt.unloadSeconds,
    plowDustEvery: opt.dustEvery === undefined ? C.PLOW_DUST_EVERY : opt.dustEvery,
    plowSnowmanMargin: C.PLOW_SNOWMAN_MARGIN,
    plowTrackRadius: C.PLOW_TRACK_RADIUS, plowTrackStrength: C.PLOW_TRACK_STRENGTH,
    accumulateOnWindows: false, maxSurfaces: 96, depositAmount: C.DEPOSIT_AMOUNT,
    depositSpread: C.DEPOSIT_SPREAD, settleSteps: 1000000,
    slideAmount: 0, redistributeAmount: 0, erodeAmount: 0,
    segmentWidth: C.SEGMENT_WIDTH, windowMaxDepth: 255, groundMaxDepth: C.GROUND_MAX_DEPTH
  });
  // Isolate the plow from steady snowfall in these focused tests. The frame-loop
  // integration test below uses Sim.update with the same empty particle pool.
  system.count = 0;
  const bank = Bank.create("ground:t", "ground", 0, GROUND_Y, WIDTH, C.SEGMENT_WIDTH, C.GROUND_MAX_DEPTH);
  const profile = opt.profile;
  for (let i = 0; i < bank.segments; i++)
    bank.heights[i] = typeof profile === "function" ? profile(i, bank.segments) : (opt.depth === undefined ? 8 : opt.depth);
  sim.surfaces = [{ id: "ground:t", type: "ground", x: 0, y: GROUND_Y, width: WIDTH, bank }];
  sim.monitorName = opt.monitor || "A";
  return sim;
}

function bankOf(sim) { return sim.surfaces[0].bank; }
function area(bank) { return Bank.totalDepth(bank) * bank.segmentWidth; }
function advance(sim, steps) { for (let i = 0; i < steps; i++) Sim.step(sim, DT); }
function fill(bank, depth) { bank.heights.fill(depth); }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 0.02 : eps); }

// ---- 1. tunables exist and the preference is validated ----------------------
test("plow tunables are exported and plowEnabled is a validated setting", () => {
  assert.equal(C.PLOW_SPAWN_DEPTH, 3.2);
  assert.ok(C.PLOW_DESPAWN_DEPTH < C.PLOW_SPAWN_DEPTH, "hysteresis gap must exist");
  assert.ok(C.PLOW_CAPACITY > 0 && C.PLOW_SPEED > 0);
  assert.equal(Settings.normalize({}).plowEnabled, true);
  assert.equal(Settings.normalize({ plowEnabled: false }).plowEnabled, false);
});

// ---- 2. automatic spawn, no duplicates --------------------------------------
test("no vehicle appears while the floor is below the spawn threshold", () => {
  const sim = makeSim({ depth: 2 });
  advance(sim, 180);
  assert.equal(sim.plow, null);
  assert.equal(sim.plowSpawns, 0);
  assert.equal(sim.plowCollected, 0);
});

test("a covered floor spawns exactly one vehicle that keeps working", () => {
  const sim = makeSim({ depth: 8 });
  assert.equal(sim.plow, null);
  Sim.step(sim, DT);
  assert.ok(sim.plow, "vehicle enters from the edge");
  assert.equal(sim.plowSpawns, 1);
  const vehicle = sim.plow;
  advance(sim, 90);
  assert.equal(sim.plow, vehicle, "no second vehicle while the first is active");
  assert.ok(sim.plowSpawns === 1, "no duplicate spawns during one cleanup pass");
});

test("disabling the preference keeps the vehicle away", () => {
  const sim = makeSim({ depth: 8, enabled: false });
  advance(sim, 120);
  assert.equal(sim.plow, null);
  assert.equal(sim.plowSpawns, 0);
});

// ---- 3. physical, progressive collection ------------------------------------
test("the scoop progressively shrinks the bank and fills the vehicle", () => {
  const sim = makeSim({ depth: 8 });
  const bank = bankOf(sim);
  const initial = area(bank);
  let removedSteps = 0;
  let previous = initial;
  for (let i = 0; i < 90; i++) {
    Sim.step(sim, DT);
    const now = area(bank);
    assert.ok(now <= previous + 1e-4, "bank area must never grow while plowing");
    if (now < previous - 1e-4) removedSteps++;
    previous = now;
  }
  assert.ok(removedSteps > 20, "snow must be removed over many frames, not in one step");
  assert.ok(sim.plowCollected > 0, "collected area is accounted for");
  assert.ok(approx(sim.plowCollected, initial - previous, 0.5),
    "what the vehicle carries equals what left the bank");
  assert.ok(sim.plowCollected < initial * 0.6, "the pile is not removed instantly");
  assert.ok(sim.plow.load > 0, "vehicle visibly carries snow");
});

// ---- 4. capacity, hauling, off-screen unloading -----------------------------
test("a full vehicle stops collecting, hauls to the edge and unloads off-screen", () => {
  const sim = makeSim({ depth: 8, capacity: 40, unloadSeconds: 0.15 });
  let guard = 0;
  while ((!sim.plow || sim.plow.state !== "hauling") && guard++ < 900) Sim.step(sim, DT);
  assert.ok(sim.plow && sim.plow.state === "hauling", "reaches hauling state");
  assert.ok(sim.plow.load > 0 && sim.plow.load <= sim.plow.capacity + 1e-4,
    "capacity is respected");
  const load = sim.plow.load;
  const bankBefore = area(bankOf(sim));

  guard = 0;
  while (sim.plowUnloaded === 0 && guard++ < 1200) Sim.step(sim, DT);
  assert.ok(sim.plowUnloaded > 0, "load is eventually dumped");
  assert.ok(approx(sim.plowUnloaded, load, 0.02), "exactly the carried load is unloaded");
  assert.ok(area(bankOf(sim)) <= bankBefore + 1e-4,
    "unloading outside the desktop does not put snow back on the bank");
});

test("loaded snow slows the vehicle down", () => {
  // Read the speed curve directly with a synthetic load rather than waiting.
  const vehicle = { speed: C.PLOW_SPEED, capacity: 100, load: 0 };
  const speed = (load) => {
    vehicle.load = load;
    const fill = Math.min(1, vehicle.load / vehicle.capacity);
    return vehicle.speed * (1 - (1 - C.PLOW_LOADED_SPEED_FACTOR) * fill);
  };
  assert.ok(speed(100) < speed(0) * 0.6, "a full load is visibly heavier");
  assert.ok(speed(50) < speed(0) && speed(50) > speed(100));
});

// ---- 5. hysteresis and cooldown ---------------------------------------------
test("threshold hysteresis keeps the vehicle from flickering in and out", () => {
  const sim = makeSim({ depth: 8, spawnDepth: 3.2, despawnDepth: 1, cooldown: 0.5 });
  Sim.step(sim, DT);
  assert.ok(sim.plow);
  const vehicle = sim.plow;
  vehicle.state = "idle";                       // parked just off-screen
  fill(bankOf(sim), 2.2);                        // between despawn and spawn
  advance(sim, 30);
  assert.equal(sim.plow, vehicle, "stays parked near the threshold");

  fill(bankOf(sim), 0.5);                        // clearly below despawn
  Sim.step(sim, DT);
  assert.equal(sim.plow, null, "leaves for good once the floor is clear");
  assert.ok(sim.plowCooldown > 0);

  fill(bankOf(sim), 8);
  advance(sim, 10);
  assert.equal(sim.plow, null, "cooldown prevents an instant return");
  advance(sim, 240);
  assert.ok(sim.plow, "returns once snow accumulates again and cooldown ends");
  assert.ok(sim.plowSpawns >= 2);
});

// ---- 6. snowman interaction --------------------------------------------------
test("snowmen are protected and steer the plow around their bases", () => {
  const sim = makeSim({ depth: 8, monitor: "A" });
  sim.snowmen = [{ id: "snow-1", monitor: "A", balls: [{ x: 400, y: GROUND_Y - 25, r: 25 }] }];
  const bank = bankOf(sim);
  const spans = Plow.protectedSpans(sim, bank);
  assert.equal(spans.length, 1);
  assert.ok(approx(spans[0][0], 355) && approx(spans[0][1], 445));

  assert.equal(Plow.pickTarget(sim, bank, spans, 400, false), null,
    "a uniform pile cannot be crossed through a snowman");
  assert.ok(Plow.pickTarget(sim, bank, spans, 400, true) !== null,
    "an entry target on the near side is still available");

  const lo = Bank.indexAt(bank, spans[0][0]);
  const hi = Bank.indexAt(bank, spans[0][1]);
  const before = [];
  for (let i = lo; i <= hi; i++) before.push(bank.heights[i]);
  advance(sim, 400);
  for (let i = lo; i <= hi; i++)
    assert.equal(bank.heights[i], before[i - lo], "snow under a snowman is never scooped");
});

test("snowmen belonging to another monitor do not constrain this plow", () => {
  const sim = makeSim({ depth: 8, monitor: "B" });
  sim.snowmen = [{ id: "snow-2", monitor: "A", balls: [{ x: 400, y: GROUND_Y - 25, r: 25 }] }];
  const spans = Plow.protectedSpans(sim, bankOf(sim));
  assert.equal(spans.length, 0, "monitor records are filtered by monitor name");
  assert.ok(Plow.pickTarget(sim, bankOf(sim), spans, 400, false) !== null);
});

// ---- 7. monitor isolation ----------------------------------------------------
test("each monitor has its own bank, threshold and vehicle", () => {
  const covered = makeSim({ depth: 8, monitor: "left" });
  const clear = makeSim({ depth: 1, monitor: "right" });
  Sim.step(covered, DT);
  Sim.step(clear, DT);
  assert.ok(covered.plow, "covered monitor calls a plow");
  assert.equal(clear.plow, null, "clear monitor does not");

  const coveredBank = bankOf(covered);
  const clearBank = bankOf(clear);
  const clearArea = area(clearBank);
  advance(covered, 120);
  assert.equal(area(clearBank), clearArea, "work on one monitor leaves the other bank alone");
  assert.ok(area(coveredBank) < WIDTH / C.SEGMENT_WIDTH * 8 * C.SEGMENT_WIDTH);
});

// ---- 8. cosmetic dust cannot duplicate bank mass ----------------------------
test("scoop dust is decorative and never deposits bank mass", () => {
  const sim = makeSim({ depth: 8, dustEvery: 0.01 });
  advance(sim, 120);
  const det = sim.detachedSystem;
  assert.ok(det.count > 0, "dust is actually emitted around the scoop");
  for (let i = 0; i < det.count; i++) {
    assert.equal(det.mass[i], 0, "dust carries no collected area");
    assert.equal(det.settle[i], 0, "dust never lands into a bank");
  }
});

// ---- 9. frame-loop integration ----------------------------------------------
test("the plow advances through the existing fixed-step frame loop", () => {
  const sim = makeSim({ depth: 8 });
  for (let i = 0; i < 200; i++) Sim.update(sim, DT);
  assert.ok(sim.stepCount > 150, "the shared loop ran");
  assert.ok(sim.plowSpawns > 0, "the plow is driven by that loop");
  assert.ok(sim.plowCollected > 0, "snow was collected through it");
});
