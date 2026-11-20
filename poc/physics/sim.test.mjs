// Phase 0 feasibility spike tests. Run with:
//   node --test poc/physics/
//
// These are real, executed assertions about pure functions. They are the only
// part of Phase 0 that can be verified on a machine without Quickshell.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEP_MS,
  MAX_DEPTH,
  createRng,
  createClock,
  createPool,
  spawn,
  stepParticles,
  createSurface,
  deposit,
  settle,
  peak,
  benchmark,
} from './sim.mjs';

test('clock: integral frame deltas produce exact step counts', () => {
  const clock = createClock(10);
  assert.equal(clock.advance(10), 1);
  assert.equal(clock.advance(10), 1);
  assert.equal(clock.advance(25), 2);
  assert.equal(clock.pending, 5);
  assert.equal(clock.droppedSteps, 0);
});

test('clock: sub-step deltas accumulate instead of being lost', () => {
  const clock = createClock(10);
  assert.equal(clock.advance(3), 0);
  assert.equal(clock.advance(3), 0);
  assert.equal(clock.advance(3), 0);
  assert.equal(clock.advance(3), 1); // 12ms -> one step, 2ms carried
  assert.ok(Math.abs(clock.pending - 2) < 1e-9);
});

test('clock: a 4000ms suspend is clamped and never fast-forwarded', () => {
  const clock = createClock(STEP_MS, 5);
  const steps = clock.advance(4000);
  assert.equal(steps, 5);
  assert.ok(clock.droppedSteps > 0);
  // The backlog is discarded, so the next frame does not inherit 4s of work.
  assert.equal(clock.advance(STEP_MS), 1);
  assert.equal(clock.droppedSteps, Math.floor(4000 / STEP_MS) - 5);
});

test('clock: garbage deltas are ignored', () => {
  const clock = createClock(10);
  for (const bad of [0, -5, NaN, Infinity, undefined]) {
    assert.equal(clock.advance(bad), 0);
  }
});

test('rng: same seed yields the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [createRng(43)(), 0, 0, 0]);
});

test('pool: capacity is a hard bound', () => {
  const pool = createPool(3);
  assert.equal(spawn(pool, 1, 1, 0, 0, 1), 0);
  assert.equal(spawn(pool, 1, 1, 0, 0, 1), 1);
  assert.equal(spawn(pool, 1, 1, 0, 0, 1), 2);
  assert.equal(spawn(pool, 1, 1, 0, 0, 1), -1);
  assert.equal(pool.count, 3);
});

test('simulation: identical fixed steps produce identical state', () => {
  const make = () => {
    const pool = createPool(64);
    const rng = createRng(7);
    for (let i = 0; i < 64; i++) spawn(pool, rng() * 500, rng() * 500, rng(), 1, 1);
    const params = { gravity: 40, drag: 0.5, wind: 2 };
    for (let s = 0; s < 500; s++) stepParticles(pool, params, STEP_MS);
    return pool;
  };
  const a = make();
  const b = make();
  assert.deepEqual(Array.from(a.x.slice(0, a.count)), Array.from(b.x.slice(0, b.count)));
  assert.deepEqual(Array.from(a.y.slice(0, a.count)), Array.from(b.y.slice(0, b.count)));
});

test('simulation: frame pacing does not change fixed-step results', () => {
  // Same total simulated time, delivered as many small frames vs few large ones.
  const run = (deltas) => {
    const pool = createPool(16);
    for (let i = 0; i < 16; i++) spawn(pool, 10 + i, 0, 0, 0, 1);
    const clock = createClock(10, 1000);
    const params = { gravity: 30, drag: 0.4, wind: 0 };
    for (const delta of deltas) {
      const steps = clock.advance(delta);
      for (let s = 0; s < steps; s++) stepParticles(pool, params, 10);
    }
    return Array.from(pool.y.slice(0, pool.count));
  };
  const sixtyFps = run(new Array(100).fill(10));
  const jittery = run([16, 4, 25, 5, 10, 40, 100, 200, 100, 0, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sixtyFps, jittery);
});

test('surface: deposit respects the depth ceiling', () => {
  const surface = createSurface(20, 2);
  for (let i = 0; i < 500; i++) deposit(surface, 20, 0, 5);
  assert.equal(surface.height[10], MAX_DEPTH);
  assert.ok(surface.total <= MAX_DEPTH + 1e-6);
});

test('surface: deposit outside the surface is a no-op', () => {
  const surface = createSurface(10, 2);
  assert.equal(deposit(surface, -50, 1, 3), 0);
  assert.equal(deposit(surface, 5000, 1, 3), 0);
  assert.equal(surface.total, 0);
});

test('surface: settle slides a tall column into lower neighbours', () => {
  const surface = createSurface(9, 2); // 18 logical px wide
  surface.height[4] = 20;
  surface.total = 20;
  settle(surface, 4);
  assert.ok(surface.height[4] < 20);
  assert.ok(surface.height[3] > 0 || surface.height[5] > 0);
});

test('surface: settle moves snow without creating or losing it', () => {
  const surface = createSurface(21, 1);
  surface.height[10] = 12;
  surface.total = 12;
  settle(surface, 4);
  // Every transfer lands in empty neighbours, far from the ceiling, so the
  // surface's total is exactly conserved and the peak must have come down.
  assert.equal(surface.total, 12);
  assert.ok(peak(surface) < 12);
});

test('surface: settle never exceeds the depth ceiling', () => {
  const surface = createSurface(31, 1);
  for (let s = 0; s < surface.segmentCount; s++) {
    surface.height[s] = (s * 7) % (MAX_DEPTH + 1);
    surface.total += surface.height[s];
  }
  for (let i = 0; i < 20; i++) settle(surface, 6);
  for (let s = 0; s < surface.segmentCount; s++) {
    assert.ok(surface.height[s] <= MAX_DEPTH, `segment ${s} over ceiling`);
  }
});

test('surface: settle is deterministic', () => {
  const build = () => {
    const surface = createSurface(41, 1);
    const rng = createRng(99);
    for (let s = 0; s < 41; s++) surface.height[s] = Math.floor(rng() * MAX_DEPTH);
    for (let i = 0; i < 50; i++) settle(surface, 8);
    return Array.from(surface.height);
  };
  assert.deepEqual(build(), build());
});

test('surface: peak reports the deepest column', () => {
  const surface = createSurface(10, 2);
  deposit(surface, 4, 0, 5);
  deposit(surface, 9, 0, 2);
  assert.equal(peak(surface), 5);
});

test('benchmark: measures a plausible per-step budget', () => {
  const result = benchmark({ particles: 1200, segments: 1920, steps: 2000 });
  assert.equal(result.surfaces, 2);
  assert.ok(result.totalMs > 0);
  // Informational: this is a measurement of this machine, not a claim.
  console.log(
    `  bench: ${result.particles} particles x ${result.surfaces} surfaces ` +
      `(${result.segments} segs each) -> ${result.perStepUs.toFixed(1)} us/step ` +
      `(${result.totalMs.toFixed(0)} ms for ${result.steps} steps)`,
  );
  // A 60Hz frame has 16667us. The spike must be far under it even on a slow VM.
  assert.ok(result.perStepUs < 16667, 'simulation step must fit inside a frame');
});
