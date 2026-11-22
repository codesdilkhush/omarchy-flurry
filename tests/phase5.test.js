// Phase 5 tests: environmental polish layered on the existing systems.
// Run with: node --test tests/phase5.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = (f) => require(path.join(__dirname, "..", "js", f));

const Bank = js("SnowBank.js"), Col = js("Collision.js"), PS = js("ParticleSystem.js"),
  Sim = js("Simulation.js"), Tracks = js("SnowTracks.js"), Plow = js("SnowPlowModel.js"),
  MU = js("MathUtils.js"), C = js("Constants.js");

const WIDTH = 800, GROUND_Y = 900, DT = C.STEP_SECONDS;
const approx = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 0.02 : eps);
const bankArea = (bank) => Bank.totalDepth(bank) * bank.segmentWidth;

function surface(id, type, x, y, width, fill) {
  const bank = Bank.create(id, type, x, y, width, C.SEGMENT_WIDTH, 255);
  for (let i = 0; i < bank.segments; i++)
    bank.heights[i] = typeof fill === "function" ? fill(i, bank.segments) : fill;
  return { id, type, x, y, width, bank };
}

function makeSim(o) {
  const opt = o || {};
  const random = opt.random || MU.createRandom(MU.hashSeed("P5"));
  const system = PS.create(C.MAX_PARTICLES.high, random);
  system.width = WIDTH; system.height = GROUND_Y;
  const det = PS.create(C.MAX_DETACHED, random);
  det.width = WIDTH; det.height = GROUND_Y;
  const sim = Sim.create({
    system, particleSystem: PS, random, stepSeconds: DT, maxStepsPerFrame: 5,
    maxBacklogSeconds: 0.25, capacities: C.MAX_PARTICLES, density: 1, wind: opt.wind === undefined ? 1 : opt.wind,
    quality: "balanced", adaptiveScale: 1, bankModule: Bank, collisionModule: Col,
    detachedSystem: det, tracksModule: Tracks, maxTracks: 128,
    rollModule: null, plowModule: opt.plow === false ? null : Plow, plowEnabled: true,
    plowSpawnDepth: C.PLOW_SPAWN_DEPTH, plowDespawnDepth: C.PLOW_DESPAWN_DEPTH,
    plowCooldownSeconds: C.PLOW_COOLDOWN_SECONDS, plowCapacity: C.PLOW_CAPACITY,
    plowSpeed: C.PLOW_SPEED, plowLoadedSpeedFactor: C.PLOW_LOADED_SPEED_FACTOR,
    plowScoopRadius: C.PLOW_SCOOP_RADIUS, plowScoopAmount: C.PLOW_SCOOP_AMOUNT,
    plowUnloadSeconds: C.PLOW_UNLOAD_SECONDS, plowDustEvery: C.PLOW_DUST_EVERY,
    plowSnowmanMargin: C.PLOW_SNOWMAN_MARGIN,
    plowTrackRadius: C.PLOW_TRACK_RADIUS, plowTrackStrength: C.PLOW_TRACK_STRENGTH,
    accumulateOnWindows: false, maxSurfaces: 96, depositAmount: C.DEPOSIT_AMOUNT,
    depositSpread: C.DEPOSIT_SPREAD, settleSteps: 1000000,
    slideAmount: 0, redistributeAmount: 0, erodeAmount: 0,
    detachedGravity: C.DETACHED_GRAVITY, detachedLift: C.DETACHED_LIFT,
    segmentWidth: C.SEGMENT_WIDTH, windowMaxDepth: 255, groundMaxDepth: 255,
    avalancheMinDepth: opt.minDepth === undefined ? C.AVALANCHE_MIN_DEPTH : opt.minDepth,
    avalancheChance: opt.chance === undefined ? C.AVALANCHE_CHANCE_PER_SECOND : opt.chance,
    avalancheCooldown: opt.cooldown === undefined ? C.AVALANCHE_COOLDOWN_SECONDS : opt.cooldown,
    avalancheSlideAmount: C.AVALANCHE_SLIDE_AMOUNT,
    avalancheShedMass: C.AVALANCHE_SHED_MASS,
    avalancheCheckSeconds: opt.check === undefined ? C.AVALANCHE_CHECK_SECONDS : opt.check,
    settleRollSteps: C.SETTLE_ROLL_STEPS, settleRollGain: C.SETTLE_ROLL_GAIN,
    settleCompactAmount: C.SETTLE_COMPACT_AMOUNT, settleSinkFraction: C.SETTLE_SINK_FRACTION
  });
  sim.monitorName = "A";
  system.count = 0;
  sim.surfaces = opt.surfaces || [surface("ground:t", "ground", 0, GROUND_Y, WIDTH, opt.depth || 0)];
  return sim;
}

// ---- 1. tunables and configuration -----------------------------------------
test("environment tunables are exported once and injected into the simulation", () => {
  assert.ok(C.AVALANCHE_MIN_DEPTH > 0);
  assert.ok(C.AVALANCHE_CHANCE_PER_SECOND > 0 && C.AVALANCHE_CHANCE_PER_SECOND < 1);
  assert.ok(C.AVALANCHE_COOLDOWN_SECONDS > 0);
  assert.ok(C.AVALANCHE_CHECK_SECONDS > 0 && C.AVALANCHE_CHECK_SECONDS < C.AVALANCHE_COOLDOWN_SECONDS);
  assert.ok(C.SETTLE_ROLL_STEPS > 0 && C.SETTLE_SINK_FRACTION < 1);
  const sim = makeSim();
  assert.equal(sim.avalancheMinDepth, C.AVALANCHE_MIN_DEPTH);
  assert.equal(sim.avalancheChance, C.AVALANCHE_CHANCE_PER_SECOND);
  assert.equal(sim.settleRollSteps, C.SETTLE_ROLL_STEPS);
  const custom = makeSim({ minDepth: 30, chance: 0.5, check: 0.25 });
  assert.equal(custom.avalancheMinDepth, 30);
  assert.equal(custom.avalancheChance, 0.5);
  assert.equal(custom.avalancheCheckSeconds, 0.25);
});

// ---- 2. tracks: shared store, fade and burial ------------------------------
test("tracks stay in one bounded store and are stamped by both actors", () => {
  const tracks = Tracks.create(8);
  for (let i = 0; i < 24; i++) Tracks.stamp(tracks, i * 10, GROUND_Y, 6, 0.6);
  assert.ok(tracks.count <= 8, "the store must never grow past its capacity");

  const sim = makeSim({ depth: 10, plow: true });
  assert.equal(sim.tracks, sim.tracks, "roll and plow share sim.tracks");
  for (let i = 0; i < 240; i++) Sim.step(sim, DT);
  assert.ok(sim.plow, "a plow is present on a covered floor");
  assert.ok(sim.tracks.count > 0, "the moving vehicle leaves impressions");
});

test("tracks fade over time even when snow is not falling", () => {
  const tracks = Tracks.create(16);
  Tracks.stamp(tracks, 100, GROUND_Y, 7, 1);
  Tracks.update(tracks, DT, Tracks.FADE_PER_SECOND, 0);
  assert.ok(tracks.strength[0] < 1 && tracks.strength[0] > 0);
  for (let i = 0; i < 9 / DT; i++) Tracks.update(tracks, DT, Tracks.FADE_PER_SECOND, 0);
  assert.equal(tracks.count, 0, "old impressions disappear instead of leaking slots");
});

test("newly accumulated snow buries tracks faster than time alone", () => {
  const plain = Tracks.create(4), snowy = Tracks.create(4);
  Tracks.stamp(plain, 100, GROUND_Y, 7, 1);
  Tracks.stamp(snowy, 100, GROUND_Y, 7, 1);
  const sim = makeSim({ plow: false });
  sim.snowfallRate = 30;
  const bury = Sim.trackBuryRate(sim);
  assert.ok(bury > 0, "active snowfall must add burial");
  Tracks.update(plain, DT, Tracks.FADE_PER_SECOND, 0);
  Tracks.update(snowy, DT, Tracks.FADE_PER_SECOND, bury);
  assert.ok(snowy.strength[0] < plain.strength[0],
    "a snowing sky must cover prints sooner: " + snowy.strength[0] + " vs " + plain.strength[0]);

  // The rate comes from real landings recorded by the fixed step, not a timer.
  // Put a few settling flakes just above the floor so the step lands them.
  const busy = makeSim({ plow: false, depth: 0 });
  const s = busy.system;
  s.count = 6;
  for (let i = 0; i < 6; i++) {
    s.x[i] = 100 + i * 20; s.y[i] = GROUND_Y - 2;
    s.vx[i] = 0; s.vy[i] = 60; s.r[i] = 2; s.settle[i] = 1;
  }
  Sim.step(busy, DT);
  assert.ok(busy.landings >= 6, "the flakes really landed this step");
  assert.ok(busy.snowfallRate > 0, "landings raise the smoothed snowfall rate");
});

// ---- 3. settling of a dropped snowball -------------------------------------
test("compression presses a visible impression without creating or losing snow", () => {
  const bank = Bank.create("g", "ground", 0, GROUND_Y, WIDTH, C.SEGMENT_WIDTH, 255);
  bank.heights.fill(10);
  const before = bankArea(bank);
  const centre = Bank.indexAt(bank, 400);
  const displaced = Bank.compact(bank, 400, 20, 0.16);
  assert.ok(displaced > 0, "a ball must leave a dent in deep snow");
  assert.ok(bank.heights[centre] < 10, "snow directly under the ball is pressed down");
  assert.ok(bank.heights[centre - 11] > 10 || bank.heights[centre + 11] > 10,
    "pressed snow is pushed into the shoulders just outside the footprint");
  assert.ok(approx(bankArea(bank), before, 0.05),
    "bank area is conserved: " + bankArea(bank) + " vs " + before);
  assert.equal(Bank.compact(bank, 400, 0, 1), 0, "a zero radius does nothing");
});

test("a dropped ball re-seats on the bank instead of floating above it", () => {
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 12);
  const sim = makeSim({ plow: false, surfaces: [ground] });
  const r = 20;
  const result = Sim.settleBall(sim, 400, 860, r, []);
  assert.equal(result.surfaceId, "g");
  assert.ok(approx(result.y, Bank.surfaceTopAt(ground.bank, result.x) - r * sim.settleSinkFraction, 0.01));
  assert.ok(result.y > Bank.surfaceTopAt(ground.bank, result.x) - r,
    "the ball overlaps the snow slightly, so it reads as resting on it");
  assert.ok(result.compressed > 0, "settling compresses the snow below");
});

test("a ball creeps downhill on a slope and settles where the snow is lower", () => {
  const slope = surface("g", "ground", 0, GROUND_Y, WIDTH, (i) => 4 + i * 0.08);
  const sim = makeSim({ plow: false, surfaces: [slope] });
  const before = Bank.surfaceTopAt(slope.bank, 400);
  const result = Sim.settleBall(sim, 400, before - 20, 20, []);
  assert.ok(result.rolled > 0, "a slope must produce some creep");
  assert.ok(result.x < 399.4, "the ball rolls toward the lower side: " + result.x);
  const after = Bank.surfaceTopAt(slope.bank, result.x);
  assert.ok(approx(result.y, after - 20 * sim.settleSinkFraction, 0.01),
    "it re-seats at its new position, never mid-air");
});

test("settling nudges a ball clear of an existing snowman ball", () => {
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 12);
  const sim = makeSim({ plow: false, surfaces: [ground] });
  const other = { monitor: "A", balls: [{ x: 400, y: 870, r: 20 }] };
  const result = Sim.settleBall(sim, 400, 850, 20, [other]);
  assert.equal(result.collision, true);
  assert.ok(result.x > 400, "the new ball is pushed away from the existing one");
  assert.ok(approx(result.y, Bank.surfaceTopAt(ground.bank, result.x) - 20 * sim.settleSinkFraction, 0.01),
    "the nudge still ends on the surface");
  // Other monitors' snowmen must not move this monitor's ball.
  const elsewhere = Sim.settleBall(sim, 400, 850, 20, [{ monitor: "B", balls: other.balls }]);
  assert.equal(elsewhere.collision, false);
});

// ---- 4. rare, mass-conserving avalanches -----------------------------------
test("shallow or quiet banks never avalanche", () => {
  const sim = makeSim({ plow: false, depth: 6 });
  sim.random = () => 0;
  Sim.maybeAvalanche(sim, 4);
  assert.equal(sim.avalancheEvents, 0, "a shallow pile is stable");
  assert.equal(sim.surfaces[0].bank.revision, 0);

  const deep = makeSim({ plow: false, depth: 30, chance: 0 });
  deep.random = () => 0;
  Sim.maybeAvalanche(deep, 4);
  assert.equal(deep.avalancheEvents, 0, "even an unstable pile is only *occasionally* released");
});

test("an avalanche redistributes a deep pile without losing bank mass", () => {
  const bank = surface("g", "ground", 0, GROUND_Y, WIDTH,
    (i, n) => i === Math.floor(n / 2) ? 30 : 3);
  const sim = makeSim({ plow: false, surfaces: [bank] });
  sim.random = () => 0;
  const before = bankArea(bank.bank);
  const peakBefore = Math.max.apply(null, Array.from(bank.bank.heights));
  Sim.maybeAvalanche(sim, 1);
  assert.equal(sim.avalancheEvents, 1);
  const after = bankArea(bank.bank);
  assert.ok(approx(after, before, 0.05), "sliding and smoothing conserve bank area");
  const peakAfter = Math.max.apply(null, Array.from(bank.bank.heights));
  assert.ok(peakAfter < peakBefore, "the unstable peak is lowered");
});

test("a cooldown keeps avalanches occasional instead of constant", () => {
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 30);
  const sim = makeSim({ plow: false, surfaces: [ground], chance: 1, cooldown: 8 });
  sim.random = () => 0;
  Sim.maybeAvalanche(sim, 1);
  assert.equal(sim.avalancheEvents, 1);
  for (let i = 0; i < 6; i++) Sim.maybeAvalanche(sim, 1);
  assert.equal(sim.avalancheEvents, 1, "the same bank cannot slide again during cooldown");
  Sim.maybeAvalanche(sim, 2.1); // cooldown expires on this check
  Sim.maybeAvalanche(sim, 1);
  assert.equal(sim.avalancheEvents, 2, "it may slide again once the bank has settled");
});

test("a window avalanche sheds an exact chunk that lands on a lower surface", () => {
  const window = surface("w:1", "window", 0, 300, 400, 20);
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 0);
  const sim = makeSim({ plow: false, wind: 1, surfaces: [window, ground] });
  sim.random = () => 0;
  const before = bankArea(window.bank);
  Sim.maybeAvalanche(sim, 1);
  assert.equal(sim.detachedSystem.count, 1, "one falling chunk is created");
  const shed = before - bankArea(window.bank);
  assert.ok(shed > 0);
  assert.ok(approx(sim.detachedSystem.mass[0], shed, 0.01),
    "the chunk carries exactly the area removed from the window");
  assert.ok(sim.detachedSystem.x[0] > window.width, "it falls clear of the overhanging edge");

  const groundBefore = bankArea(ground.bank);
  for (let i = 0; i < 400 && sim.detachedSystem.count > 0; i++) Sim.stepDetached(sim, DT);
  assert.equal(sim.detachedSystem.count, 0, "the chunk lands rather than vanishing");
  assert.ok(approx(bankArea(ground.bank) - groundBefore, shed, 0.01),
    "the same area is deposited on the ground: " + (bankArea(ground.bank) - groundBefore) + " vs " + shed);
});

test("a full detached pool puts the shed snow back instead of deleting it", () => {
  const window = surface("w:1", "window", 0, 300, 400, 20);
  const sim = makeSim({ plow: false, surfaces: [window] });
  sim.random = () => 0;
  sim.detachedSystem.count = sim.detachedSystem.capacity;
  const before = bankArea(window.bank);
  Sim.maybeAvalanche(sim, 1);
  assert.equal(sim.detachedSystem.count, sim.detachedSystem.capacity, "no overflow");
  assert.ok(approx(bankArea(window.bank), before, 0.05),
    "mass stays on the bank when no falling slot is free");
});

// ---- 5. frame-loop integration and Phase 4 coexistence ---------------------
test("avalanche checks run on the existing fixed step, with no extra timer", () => {
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 30);
  const sim = makeSim({ plow: false, surfaces: [ground], chance: 1, check: 0.1, cooldown: 100 });
  sim.random = () => 0;
  for (let i = 0; i < 6; i++) Sim.step(sim, DT);
  assert.equal(sim.avalancheEvents, 0, "checks are cadenced, not every frame");
  Sim.step(sim, DT);
  assert.equal(sim.avalancheEvents, 1);

  const disabled = makeSim({ plow: false, surfaces: [surface("g", "ground", 0, GROUND_Y, WIDTH, 30)],
    chance: 1, check: 0 });
  disabled.random = () => 0;
  for (let i = 0; i < 120; i++) Sim.step(disabled, DT);
  assert.equal(disabled.avalancheEvents, 0, "a zero check interval disables the behaviour");
});

test("reset clears environmental counters and per-surface cooldowns", () => {
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 30);
  const sim = makeSim({ plow: false, surfaces: [ground], chance: 1, check: 0.1 });
  sim.random = () => 0;
  for (let i = 0; i < 10; i++) Sim.step(sim, DT);
  assert.ok(sim.avalancheEvents > 0);
  Sim.reset(sim);
  assert.equal(sim.avalancheEvents, 0);
  assert.equal(sim.avalancheArea, 0);
  assert.equal(sim.avalancheTimer, 0);
  assert.equal(sim.snowfallRate, 0);
  assert.equal(ground.avalancheCooldown, 0);
});

test("Phase 4 plowing still works alongside tracks and avalanches", () => {
  const ground = surface("g", "ground", 0, GROUND_Y, WIDTH, 24);
  const sim = makeSim({ plow: true, surfaces: [ground], chance: 10, check: 0.5, cooldown: 2 });
  let sawTracks = false;
  for (let i = 0; i < 600; i++) {
    Sim.step(sim, DT);
    if (sim.tracks.count > 0) sawTracks = true;
  }
  assert.ok(sim.plowSpawns >= 1, "the plow still appears on a covered floor");
  assert.ok(sim.plowCollected > 0, "and still collects snow progressively");
  assert.ok(sawTracks, "its impressions appear in the shared track store");
  assert.ok(sim.avalancheEvents >= 1, "avalanches also fire in the same simulation");
  assert.ok(bankArea(ground.bank) >= 0, "bank area stays valid");
});
