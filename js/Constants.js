// Tunables and hard limits for Snowglobe.
//
// QML JavaScript files cannot import other JavaScript files, so this module is
// deliberately self-contained: it holds no references to Settings.js or State.js.
// Anything a later phase needs to bound belongs here, once, so no subsystem
// invents its own ceiling.

// Simulation.
var STEP_HZ = 60;                     // fixed simulation step
var STEP_SECONDS = 1 / STEP_HZ;
var MAX_STEPS_PER_FRAME = 5;          // clamp after a suspend; discard the rest
var MAX_BACKLOG_SECONDS = 0.25;

// Particles, per monitor.
var MAX_PARTICLES = {
  low: 250,
  balanced: 600,
  high: 1200
};

// Accumulation.
var SEGMENT_WIDTH = 2;                // logical px per height-map segment
var MAX_DEPTH = 255;                  // Uint8 per segment
var MAX_SURFACES = 96;                // per monitor
var MAX_SNOWMEN_PER_MONITOR = 12;
var MAX_SNOWMEN = 64;                 // total, persisted

// Geometry polling.
var POLL_FAST_MS = 100;
var POLL_IDLE_MS = 500;
var MAX_TRACKED_WINDOWS = 64;

// Overlay.
var OVERLAY_NAMESPACE = "snowglobe";
var OVERLAY_MODES = ["passive", "disabled"];
var LAYERS = ["behind", "above"];

// Persistence.
var STATE_VERSION = 1;
var MAX_STATE_BYTES = 256 * 1024;

// QML cannot see this guard: `module` is undefined there, so the branch is
// skipped. Node sees it, which is how the dev-only tests import this file.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STEP_HZ: STEP_HZ,
    STEP_SECONDS: STEP_SECONDS,
    MAX_STEPS_PER_FRAME: MAX_STEPS_PER_FRAME,
    MAX_BACKLOG_SECONDS: MAX_BACKLOG_SECONDS,
    MAX_PARTICLES: MAX_PARTICLES,
    SEGMENT_WIDTH: SEGMENT_WIDTH,
    MAX_DEPTH: MAX_DEPTH,
    MAX_SURFACES: MAX_SURFACES,
    MAX_SNOWMEN_PER_MONITOR: MAX_SNOWMEN_PER_MONITOR,
    MAX_SNOWMEN: MAX_SNOWMEN,
    POLL_FAST_MS: POLL_FAST_MS,
    POLL_IDLE_MS: POLL_IDLE_MS,
    MAX_TRACKED_WINDOWS: MAX_TRACKED_WINDOWS,
    OVERLAY_NAMESPACE: OVERLAY_NAMESPACE,
    OVERLAY_MODES: OVERLAY_MODES,
    LAYERS: LAYERS,
    STATE_VERSION: STATE_VERSION,
    MAX_STATE_BYTES: MAX_STATE_BYTES
  };
}
