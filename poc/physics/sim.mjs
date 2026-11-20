// Snowglobe Phase 0 feasibility spike — NOT production code.
//
// Purpose: prove the two data-representation decisions the architecture rests on
// before any production module is written:
//
//   1. A fixed-timestep accumulator keeps the simulation deterministic and stable
//      across wildly varying frame deltas (the "shell was suspended for 4s" case).
//   2. Snow accumulation as a per-surface, fixed-segment height map in typed arrays
//      is bounded, cheap to update, and deterministic.
//
// Everything here is pure arithmetic over typed arrays: no QML, no timers, no I/O.
// The numbers produced by benchmark() are measured on the machine that runs this
// file, which is the only performance claim Phase 0 is allowed to make.

export const STEP_MS = 1000 / 60; // fixed simulation step
export const MAX_STEPS_PER_FRAME = 5; // clamp after suspend/resume
export const MAX_DEPTH = 24; // segment height ceiling, in logical px

/** Deterministic 32-bit PRNG (mulberry32). Same seed => same run, always. */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Accumulator that converts arbitrary frame deltas into whole fixed steps.
 * Returns the number of steps to run this frame; the caller never sees a
 * fractional step, so the integration order can never change with frame rate.
 */
export function createClock(stepMs = STEP_MS, maxSteps = MAX_STEPS_PER_FRAME) {
  let accumulator = 0;
  let dropped = 0;
  return {
    get droppedSteps() {
      return dropped;
    },
    get pending() {
      return accumulator;
    },
    /** @returns {number} steps to run now */
    advance(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
      accumulator += deltaMs;
      let steps = Math.floor(accumulator / stepMs);
      accumulator -= steps * stepMs;
      if (steps > maxSteps) {
        dropped += steps - maxSteps;
        steps = maxSteps;
        // Discard the backlog entirely rather than integrating it over the
        // following frames: a resumed shell must not fast-forward.
        accumulator = 0;
      }
      return steps;
    },
  };
}

/** Storage-backed particle pool. Growth happens only during construction. */
export function createPool(capacity) {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    r: new Float32Array(capacity),
    alive: new Uint8Array(capacity),
  };
}

export function spawn(pool, x, y, vx, vy, r) {
  if (pool.count >= pool.capacity) return -1;
  const i = pool.count++;
  pool.x[i] = x;
  pool.y[i] = y;
  pool.vx[i] = vx;
  pool.vy[i] = vy;
  pool.r[i] = r;
  pool.alive[i] = 1;
  return i;
}

/**
 * One fixed step of falling-snow motion: gravity, linear air drag, wind.
 * Wind is a scalar acceleration so it stays a cheap first-order term.
 */
export function stepParticles(pool, params, dtMs) {
  const dt = dtMs / 1000;
  const { gravity, drag, wind } = params;
  const damp = Math.max(0, 1 - drag * dt);
  for (let i = 0; i < pool.count; i++) {
    if (!pool.alive[i]) continue;
    pool.vy[i] = (pool.vy[i] + (gravity + wind) * dt) * damp;
    pool.vx[i] *= damp;
    pool.x[i] += pool.vx[i] * dt;
    pool.y[i] += pool.vy[i] * dt;
  }
}

/**
 * A snow surface as a fixed-segment height map.
 * `width` segments each `segmentWidth` logical px wide; `height` is a Uint8
 * depth per segment. Memory is width bytes regardless of how much snow falls.
 */
export function createSurface(segmentCount, segmentWidth = 2) {
  return {
    segmentCount,
    segmentWidth,
    height: new Uint8Array(segmentCount),
    total: 0,
  };
}

export function segmentAt(surface, x) {
  const s = Math.floor(x / surface.segmentWidth);
  return s < 0 || s >= surface.segmentCount ? -1 : s;
}

/** Deposit snow at a logical x with a soft radial footprint. */
export function deposit(surface, x, radiusSegments = 1, amount = 1) {
  const centre = segmentAt(surface, x);
  if (centre < 0) return 0;
  let added = 0;
  for (let d = -radiusSegments; d <= radiusSegments; d++) {
    const s = centre + d;
    if (s < 0 || s >= surface.segmentCount) continue;
    const before = surface.height[s];
    if (before >= MAX_DEPTH) continue;
    const weight = 1 / (1 + Math.abs(d)); // centre heaviest
    const next = Math.min(MAX_DEPTH, before + amount * weight);
    if (next > before) {
      surface.height[s] = next;
      surface.total += next - before;
      added += next - before;
    }
  }
  return added;
}

/**
 * Stability pass: snow above `slideThreshold` moves downhill into a lower
 * neighbour. Bounded to one pass per step so cost is O(segments) and the
 * result is order-dependent but deterministic.
 */
export function settle(surface, slideThreshold = 12) {
  let moved = 0;
  for (let s = 1; s < surface.segmentCount - 1; s++) {
    const h = surface.height[s];
    if (h <= slideThreshold) continue;
    const left = surface.height[s - 1];
    const right = surface.height[s + 1];
    const lower = left <= right ? s - 1 : s + 1;
    const drop = h - surface.height[lower];
    if (drop <= 1) continue;
    const transfer = Math.min(h - slideThreshold, Math.floor(drop / 2));
    if (transfer <= 0) continue;
    const receiverBefore = surface.height[lower];
    const receiverAfter = Math.min(MAX_DEPTH, receiverBefore + transfer);
    const accepted = receiverAfter - receiverBefore;
    if (accepted <= 0) continue;
    surface.height[s] -= accepted;
    surface.height[lower] = receiverAfter;
    // Snow that the receiver could not take stays where it was: the map never
    // silently loses mass.
    surface.total -= 0;
    moved += accepted;
  }
  return moved;
}

/** Highest snow column anywhere on the surface — what the renderer must blit. */
export function peak(surface) {
  let maxDepth = 0;
  for (let s = 0; s < surface.segmentCount; s++) {
    if (surface.height[s] > maxDepth) maxDepth = surface.height[s];
  }
  return maxDepth;
}

/**
 * Minimal benchmark used by the Phase 0 report. Measures the per-step cost of a
 * full particle + accumulation tick at the sizes the architecture proposes,
 * on whatever machine runs it.
 */
export function benchmark({ particles = 1200, segments = 1920, steps = 6000 } = {}) {
  const pool = createPool(particles);
  const rng = createRng(1234);
  for (let i = 0; i < particles; i++) {
    spawn(pool, rng() * segments, rng() * 1000, 0, 0, 1 + rng() * 2);
  }
  const surfaces = [];
  for (let m = 0; m < 2; m++) surfaces.push(createSurface(segments));
  const params = { gravity: 42, drag: 0.6, wind: 3 };

  const started = process.hrtime.bigint();
  for (let step = 0; step < steps; step++) {
    stepParticles(pool, params, STEP_MS);
    for (const surface of surfaces) {
      deposit(surface, (step * 7.3) % segments, 2, 0.4);
      settle(surface);
    }
    // Recycle anything that fell off the bottom.
    for (let i = 0; i < pool.count; i++) {
      if (pool.y[i] > 1200) {
        pool.y[i] = -10;
        pool.vy[i] = 0;
      }
    }
  }
  const elapsedNs = Number(process.hrtime.bigint() - started);

  let deposits = 0;
  for (const surface of surfaces) deposits += surface.total;

  return {
    particles,
    segments,
    steps,
    totalMs: elapsedNs / 1e6,
    perStepUs: elapsedNs / 1e3 / steps,
    surfaces: surfaces.length,
    snowUnits: Math.round(deposits),
    peaks: surfaces.map(peak),
  };
}
