// Snow conservation when a rolled ball is abandoned (Escape, a stroke too small
// to keep, a cancelled press).
//
// In 1.1.1 returnSnow() looked for a surface *at or below* the ball. A ball
// rolled through a deep pile sits well under the pile's top, so the pile counted
// as "above" it, nothing was found and 100% of the scooped snow vanished,
// leaving a permanent dent. These tests are deterministic (no timers, no QML).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const js = (f) => require(path.join(__dirname, "..", "js", f));

const Bank = js("SnowBank.js"), PS = js("ParticleSystem.js"), Sim = js("Simulation.js"),
  Col = js("Collision.js"), Roll = js("SnowRoll.js"), C = js("Constants.js"), MU = js("MathUtils.js");

const GROUND_Y = 500;

// One quiet monitor: no snowfall, no plough, no avalanches, so the only snow
// movement is the roller's. `extra` adds window surfaces.
function makeSim(groundHeight, extra) {
  const random = MU.createRandom(MU.hashSeed("snow-return"));
  const system = PS.create(10, random); system.width = 800; system.height = GROUND_Y; system.count = 0;
  const det = PS.create(8, random); det.width = 800; det.height = GROUND_Y;
  const sim = Sim.create({
    system, particleSystem: PS, random, stepSeconds: C.STEP_SECONDS, maxStepsPerFrame: 5,
    maxBacklogSeconds: 0.25, capacities: C.MAX_PARTICLES, density: 0, wind: 0, quality: "balanced",
    adaptiveScale: 1, bankModule: Bank, collisionModule: Col, detachedSystem: det, rollModule: Roll,
    plowModule: null, plowEnabled: false, accumulateOnWindows: false, maxSurfaces: 8,
    depositAmount: 0, depositSpread: C.DEPOSIT_SPREAD, settleSteps: 1000000, slideAmount: 0,
    redistributeAmount: 0, erodeAmount: 0, segmentWidth: C.SEGMENT_WIDTH,
    windowMaxDepth: C.WINDOW_MAX_DEPTH, groundMaxDepth: C.GROUND_MAX_DEPTH
  });
  const ground = Bank.create("ground:t", "ground", 0, GROUND_Y, 800, C.SEGMENT_WIDTH, C.GROUND_MAX_DEPTH);
  ground.heights.fill(groundHeight);
  sim.surfaces = [{ id: "ground:t", type: "ground", x: 0, y: GROUND_Y, width: 800, bank: ground }];
  for (const w of extra || []) {
    const bank = Bank.create(w.id, "window", w.x, w.y, w.width, C.SEGMENT_WIDTH, C.WINDOW_MAX_DEPTH);
    bank.heights.fill(w.height);
    sim.surfaces.push({ id: w.id, type: "window", x: w.x, y: w.y, width: w.width, bank });
  }
  return { sim, ground };
}

const area = (bank) => Bank.totalDepth(bank) * bank.segmentWidth;

// Press at (x, y), drag along `path`, abandon, return the snow where the ball is.
function rollAndAbandon(sim, startX, startY, drag) {
  Sim.beginRoll(sim, startX, startY);
  for (const [x, y] of drag) {
    Sim.setRollTarget(sim, x, y);
    for (let k = 0; k < 20; k++) Sim.step(sim, C.STEP_SECONDS);
  }
  const ball = Sim.takeRoll(sim);
  return { ball, given: Sim.returnSnow(sim, ball.x, ball.y, ball.area) };
}

function circle(cx, cy, r) {
  const pts = [];
  for (let a = 0; a <= 6.3; a += 0.3) pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  return pts;
}

test("abandoning a ball rolled INSIDE a deep pile returns all of its snow", () => {
  const { sim, ground } = makeSim(39);
  const before = area(ground);
  const { ball, given } = rollAndAbandon(sim, 360, 480, circle(300, 480, 60));
  assert.ok(before - area(ground) < before, "sanity");
  assert.ok(ball.area > 50, "the roller must actually have gathered snow, got " + ball.area);
  assert.ok(ball.y > GROUND_Y - 39 + 12, "ball must be deeper than the old 12px slack (y=" + ball.y + ")");
  assert.ok(Math.abs(given - ball.area) < 0.5, "returned " + given + " of " + ball.area);
  assert.ok(Math.abs(area(ground) - before) < 0.5, "pile must be whole again");
});

test("a ball released above the pile still returns all of its snow", () => {
  const { sim, ground } = makeSim(39);
  const before = area(ground);
  const { ball, given } = rollAndAbandon(sim, 360, 480, [[360, 480], [360, 300]]);
  assert.ok(ball.area > 10);
  assert.ok(Math.abs(given - ball.area) < 0.5);
  assert.ok(Math.abs(area(ground) - before) < 0.5);
});

test("shallow piles keep working (the case that always worked)", () => {
  const { sim, ground } = makeSim(10);
  const before = area(ground);
  const { ball, given } = rollAndAbandon(sim, 360, 495, [[360, 495], [420, 495], [480, 495]]);
  assert.ok(ball.area > 50);
  assert.ok(Math.abs(given - ball.area) < 0.5);
  assert.ok(Math.abs(area(ground) - before) < 0.5);
});

test("a pile at its per-segment limit still gets all its snow back", () => {
  // Soft-mound passes clip on full segments; the nearest-free-space pass must
  // pick up the remainder.
  const { sim, ground } = makeSim(C.GROUND_MAX_DEPTH);
  const before = area(ground);
  const { ball, given } = rollAndAbandon(sim, 360, 460, [[360, 460], [420, 460], [480, 460]]);
  assert.ok(ball.area > 50);
  assert.ok(Math.abs(given - ball.area) < 0.5, "returned " + given + " of " + ball.area);
  assert.ok(Math.abs(area(ground) - before) < 0.5);
  for (let i = 0; i < ground.segments; i++)
    assert.ok(ground.heights[i] <= ground.limit[i] + 1e-4, "segment " + i + " over its limit");
});

test("snow goes back to the pile it came from, not to a window cap higher up", () => {
  const { sim, ground } = makeSim(39, [{ id: "window:1", x: 100, y: 200, width: 600, height: 10 }]);
  const windowBank = sim.surfaces[1].bank;
  const groundBefore = area(ground), windowBefore = area(windowBank);
  const { ball, given } = rollAndAbandon(sim, 360, 480, circle(300, 480, 60));
  assert.ok(Math.abs(given - ball.area) < 0.5);
  assert.ok(Math.abs(area(ground) - groundBefore) < 0.5, "ground must be restored");
  assert.strictEqual(area(windowBank), windowBefore, "window cap must be untouched");
});

test("nothing is conjured: returning snow never exceeds what the bank can hold", () => {
  const { sim, ground } = makeSim(C.GROUND_MAX_DEPTH);
  const before = area(ground);
  const given = Sim.returnSnow(sim, 400, 470, 5000);
  assert.strictEqual(given, 0, "a completely full pile has no room");
  assert.strictEqual(area(ground), before);
  assert.ok(!Number.isNaN(given));
});

test("Collision.surfaceHolding: inside the snow yes, above the snow no", () => {
  const { sim } = makeSim(39);
  const inside = Col.surfaceHolding(Bank, sim.surfaces, 400, 480);
  assert.ok(inside && inside.surface.id === "ground:t");
  assert.strictEqual(Col.surfaceHolding(Bank, sim.surfaces, 400, 300), null, "above the pile");
  assert.strictEqual(Col.surfaceHolding(Bank, sim.surfaces, 900, 480), null, "outside the surface");
  assert.strictEqual(Col.surfaceHolding(Bank, sim.surfaces, 400, GROUND_Y + 50), null, "below the base line");
});

test("SnowBank.fillNearest: nearest room first, limits respected, mass reported exactly", () => {
  const bank = Bank.create("g", "ground", 0, GROUND_Y, 100, 2, 20);   // 50 segments
  bank.heights.fill(20);                                              // full
  bank.heights[10] = 15; bank.heights[11] = 18; bank.heights[30] = 0; // room: 5 + 2 + 20 = 27 units
  // x = 21 is segment 10. 4 height units over 2px segments = area 8.
  const placed = Bank.fillNearest(bank, 21, 8);
  assert.ok(Math.abs(placed - 8) < 1e-4, "placed " + placed);
  assert.ok(Math.abs(bank.heights[10] - 19) < 1e-4, "all 4 units fit in the nearest segment (room 5): " + bank.heights[10]);
  assert.strictEqual(bank.heights[11], 18, "neighbour untouched while nearer room exists");
  assert.strictEqual(bank.heights[30], 0, "far room untouched while near room exists");
  // Ask for more than the whole bank can hold: only the free capacity is used.
  const all = Bank.fillNearest(bank, 20, 1e6);
  assert.ok(Math.abs(all - (27 - 4) * 2) < 1e-3, "free capacity only, got " + all);
  for (let i = 0; i < bank.segments; i++) assert.ok(bank.heights[i] <= bank.limit[i] + 1e-4);
  assert.strictEqual(Bank.fillNearest(bank, 20, 0), 0);
  assert.strictEqual(Bank.fillNearest(bank, 20, -3), 0);
});
