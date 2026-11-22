// Deterministic helpers for Snowglobe's simulation.
//
// Self-contained on purpose: QML JavaScript files cannot import other
// JavaScript files, so every module that needs randomness receives a `random`
// function created here rather than importing this file.

// mulberry32: small, fast, good enough for bounded particle variation.
// The same seed always produces the same stream, which makes physics tests
// reproducible.
function createRandom(seed) {
  var s = seed >>> 0;
  return function random() {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable string -> 32-bit seed, so a monitor name maps to a fixed stream.
function hashSeed(text) {
  var str = String(text || "");
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createRandom: createRandom,
    hashSeed: hashSeed,
    clamp: clamp,
    lerp: lerp
  };
}
