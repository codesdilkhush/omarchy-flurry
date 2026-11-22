// Bounded particle storage for Snowglobe.
//
// Particles live in parallel typed arrays, never as QML objects and never as an
// array of per-particle objects. The arrays are allocated once at capacity;
// `count` is the only thing that grows or shrinks. This keeps allocation
// pressure at zero during animation and makes the renderer a simple loop.
//
// Self-contained: QML cannot import other JS files, so randomness is injected
// as a `random()` function supplied by the caller.

// Share of flakes that are allowed to land. The rest stay visible in front of
// windows all the way down, which is what makes snow look like it falls *on*
// the desktop rather than only on the edges of windows.
var SETTLE_FRACTION = 0.5;

var TYPES = [
  { min: 0.7, max: 1.3, weight: 0.60 }, // small flake
  { min: 1.3, max: 2.1, weight: 0.30 }, // medium flake
  { min: 2.1, max: 3.2, weight: 0.10 }  // large clump
];

function create(capacity, random) {
  var cap = Math.max(1, Math.floor(capacity));
  return {
    capacity: cap,
    count: 0,
    width: 1920,
    height: 1080,
    random: typeof random === "function" ? random : Math.random,
    // Simulation state.
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    r: new Float32Array(cap),
    rot: new Float32Array(cap),
    vr: new Float32Array(cap),
    alpha: new Float32Array(cap),
    phase: new Float32Array(cap),
    type: new Uint8Array(cap),
    // 1 = may settle on a surface, 0 = purely decorative: falls across the
    // whole screen (over window bodies too) and is recycled at the bottom.
    settle: new Uint8Array(cap),
    // Area (px^2) this flake carries from a bank when it was shed. Steady
    // snowfall and cosmetic dust carry 0; a shed chunk carries exactly what
    // takeFromSegment() removed, so landing can deposit it back unchanged.
    mass: new Float32Array(cap)
  };
}

function pickType(rnd) {
  var roll = rnd();
  var acc = 0;
  for (var i = 0; i < TYPES.length; i++) {
    acc += TYPES[i].weight;
    if (roll <= acc) return i;
  }
  return TYPES.length - 1;
}

// Place particle i. `initial` seeds the screen already full of snow; otherwise
// the particle enters from just above the top edge.
function spawn(system, i, initial) {
  var rnd = system.random;
  var type = pickType(rnd);
  var spec = TYPES[type];
  var radius = spec.min + rnd() * (spec.max - spec.min);

  system.x[i] = rnd() * system.width;
  system.y[i] = initial ? rnd() * system.height : -8 - rnd() * system.height * 0.15;
  system.vx[i] = (rnd() - 0.5) * 4;
  system.vy[i] = 18 + radius * 10;
  system.r[i] = radius;
  system.rot[i] = rnd() * 360;
  system.vr[i] = (rnd() - 0.5) * 36;
  system.alpha[i] = 0.35 + rnd() * 0.5;
  system.phase[i] = rnd() * 6.2831853;
  system.type[i] = type;
  system.settle[i] = rnd() < SETTLE_FRACTION ? 1 : 0;
  system.mass[i] = 0;
}

function resize(system, width, height) {
  var w = Math.max(1, width);
  var h = Math.max(1, height);
  var sx = w / system.width;
  var sy = h / system.height;
  for (var i = 0; i < system.count; i++) {
    system.x[i] *= sx;
    system.y[i] *= sy;
  }
  system.width = w;
  system.height = h;
}

// Grow or shrink the active pool. New particles are seeded across the screen so
// a density increase does not produce a visible "curtain" from the top.
function setCount(system, wanted) {
  var target = Math.max(0, Math.min(system.capacity, Math.floor(wanted)));
  if (target > system.count) {
    for (var i = system.count; i < target; i++) spawn(system, i, true);
  }
  system.count = target;
}

// Place a particle with an explicit state. Used for snow shed by a moving
// window: its initial velocity comes from the window, not from spawn().
// `settle` defaults to 1 (may land and deposit). Rolling contact dust passes 0
// so it falls across the desktop as decoration and never duplicates bank mass.
// `area` is the exact bank area being handed to this flake; it defaults to 0.
function inject(system, x, y, vx, vy, radius, alpha, type, settle, area) {
  if (system.count >= system.capacity) return -1;
  var i = system.count++;
  system.x[i] = x;
  system.y[i] = y;
  system.vx[i] = vx;
  system.vy[i] = vy;
  system.r[i] = radius;
  system.rot[i] = 0;
  system.vr[i] = (system.random() - 0.5) * 60;
  system.alpha[i] = alpha;
  system.phase[i] = system.random() * 6.2831853;
  system.type[i] = type;
  system.settle[i] = settle === 0 ? 0 : 1;
  system.mass[i] = area > 0 ? area : 0;
  return i;
}

// Remove a particle by swapping in the last slot: no allocation and no holes.
function remove(system, index) {
  if (index < 0 || index >= system.count) return false;
  var last = system.count - 1;
  if (index !== last) {
    system.x[index] = system.x[last];
    system.y[index] = system.y[last];
    system.vx[index] = system.vx[last];
    system.vy[index] = system.vy[last];
    system.r[index] = system.r[last];
    system.rot[index] = system.rot[last];
    system.vr[index] = system.vr[last];
    system.alpha[index] = system.alpha[last];
    system.phase[index] = system.phase[last];
    system.type[index] = system.type[last];
    system.settle[index] = system.settle[last];
    system.mass[index] = system.mass[last];
  }
  system.count--;
  return true;
}

function reset(system) {
  for (var i = 0; i < system.count; i++) spawn(system, i, true);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TYPES: TYPES,
    SETTLE_FRACTION: SETTLE_FRACTION,
    create: create,
    spawn: spawn,
    resize: resize,
    setCount: setCount,
    inject: inject,
    remove: remove,
    reset: reset
  };
}
