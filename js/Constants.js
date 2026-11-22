// Tunables and hard limits for Snowglobe.
//
// QML JavaScript files cannot import other JavaScript files, so this module is
// deliberately self-contained: it holds no references to Settings.js or State.js.
// Anything a later phase needs to bound belongs here, once, so no subsystem
// invents its own ceiling.

// Identity.
var SERVICE_VERSION = "1.1.1";
var SETTINGS_SCHEMA_VERSION = 1;

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

// Accumulation (logical pixels).
var WINDOW_MAX_DEPTH = 26;           // cap on a window-top bank
var GROUND_MAX_DEPTH = 56;           // cap on a monitor-bottom bank
var DEPOSIT_AMOUNT = 2.4;            // height units at the centre of one landed flake's mound
var DEPOSIT_SPREAD = 6;              // neighbouring segments sharing a deposit (soft mound)
var BANK_SETTLE_STEPS = 45;          // steps between settling passes
var BANK_SLIDE_AMOUNT = 0.05;        // downwind transfer per settling pass
var BANK_REDISTRIBUTE_AMOUNT = 0.25; // peak smoothing per settling pass
var BANK_ERODE_AMOUNT = 0.004;       // very slow melting, keeps banks bounded

// Window movement physics.
var MAX_DETACHED = 128;              // detached-particle pool per monitor
var ROLL_TRACK_CAPACITY = 192;       // pressed tracks per monitor (rolling + plow)
var WINDOW_SLIDE_SPEED = 40;         // px/s below which snow moves rigidly
var WINDOW_DETACH_SPEED = 180;       // px/s at which snow starts shedding
var WINDOW_SLIDE_AMOUNT = 1.2;       // height units transferred per event
var WINDOW_DETACH_MASS = 2.5;        // height units lifted per light flake
var WINDOW_DETACH_MAX_PER_EVENT = 6; // bounded shedding per geometry update
var WINDOW_VELOCITY_INHERIT = 0.55;  // share of window velocity inherited
var DETACHED_GRAVITY = 140;          // px/s^2 for detached flakes
var DETACHED_LIFT = 14;              // initial upward kick when shed

// Tiered window snow. A segment's depth decides how it lets go: thin drifts
// shed single flakes, medium ones split into a couple of tumbling pieces, and
// deep banks slide to the trailing edge first and only sometimes break off.
var WINDOW_MEDIUM_DEPTH = 6;         // segment depth that sheds as a small cluster
var WINDOW_HEAVY_DEPTH = 12;         // segment depth that breaks into chunks
var WINDOW_MEDIUM_MASS = 4.5;        // height units removed from a medium segment
var WINDOW_HEAVY_MASS = 8;           // height units removed from a heavy segment
var WINDOW_CHUNK_CHANCE = 0.45;      // chance per event that a heavy segment breaks
var WINDOW_SHED_KICK = 0.9;          // share of window speed added toward the trailing edge

// Snow-eating bulldozer. One vehicle per monitor, owned by the simulation and
// advanced by the existing fixed step. Thresholds are average ground-bank depth
// in height units; the gap between spawn and despawn is the hysteresis.
var PLOW_SPAWN_DEPTH = 3.2;           // average floor depth that calls a plow in
var PLOW_DESPAWN_DEPTH = 1.0;         // average depth at which it goes idle
var PLOW_COOLDOWN_SECONDS = 3;        // pause after leaving before it can return
var PLOW_CAPACITY = 640;              // carried area (px^2) before unloading
var PLOW_SPEED = 88;                  // px/s unloaded
var PLOW_LOADED_SPEED_FACTOR = 0.45;  // speed multiplier when completely full
var PLOW_SCOOP_RADIUS = 13;           // front brush width in px
var PLOW_SCOOP_AMOUNT = 0.16;         // height units lifted per segment per step
var PLOW_UNLOAD_SECONDS = 0.7;        // dwell off-screen while dumping the load
var PLOW_DUST_EVERY = 0.09;           // seconds between scoop dust particles
var PLOW_SNOWMAN_MARGIN = 20;         // px kept clear around a snowman's base
var PLOW_TRACK_RADIUS = 9;
var PLOW_TRACK_STRENGTH = 0.5;

// Environmental polish. Avalanches are rare: a bank must be clearly unstable,
// then a low per-second chance and a per-surface cooldown keep the effect
// occasional rather than a constant shimmer. Settling constants shape how a
// released snowball rests on and compresses a pile.
var AVALANCHE_MIN_DEPTH = 16;         // peak segment depth that may let go
var AVALANCHE_CHANCE_PER_SECOND = 0.06;
var AVALANCHE_COOLDOWN_SECONDS = 8;
var AVALANCHE_SLIDE_AMOUNT = 2.4;     // height units shifted downwind per event
var AVALANCHE_SHED_MASS = 4;          // height units handed to a falling chunk
var AVALANCHE_CHECK_SECONDS = 0.5;    // interval between stability checks
var SETTLE_ROLL_STEPS = 3;            // iterations of downhill creep on release
var SETTLE_ROLL_GAIN = 0.18;          // fraction of the local height difference
var SETTLE_COMPACT_AMOUNT = 0.16;     // height units pressed under the ball
var SETTLE_SINK_FRACTION = 0.92;      // ball radius below the surface top

// Adaptive quality and fullscreen behaviour.
var ADAPTIVE_BUDGET_MS = 8;          // reduce quality above this frame cost
var ADAPTIVE_RECOVER_MS = 3;         // restore quality below this frame cost
var ADAPTIVE_STEP = 0.1;
var ADAPTIVE_MIN_SCALE = 0.4;
var ADAPTIVE_MAX_SCALE = 1;
var ADAPTIVE_CHECK_MS = 2000;

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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SERVICE_VERSION: SERVICE_VERSION,
    SETTINGS_SCHEMA_VERSION: SETTINGS_SCHEMA_VERSION,
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
    WINDOW_MAX_DEPTH: WINDOW_MAX_DEPTH,
    GROUND_MAX_DEPTH: GROUND_MAX_DEPTH,
    DEPOSIT_AMOUNT: DEPOSIT_AMOUNT,
    DEPOSIT_SPREAD: DEPOSIT_SPREAD,
    BANK_SETTLE_STEPS: BANK_SETTLE_STEPS,
    BANK_SLIDE_AMOUNT: BANK_SLIDE_AMOUNT,
    BANK_REDISTRIBUTE_AMOUNT: BANK_REDISTRIBUTE_AMOUNT,
    BANK_ERODE_AMOUNT: BANK_ERODE_AMOUNT,
    MAX_DETACHED: MAX_DETACHED,
    ROLL_TRACK_CAPACITY: ROLL_TRACK_CAPACITY,
    WINDOW_SLIDE_SPEED: WINDOW_SLIDE_SPEED,
    WINDOW_DETACH_SPEED: WINDOW_DETACH_SPEED,
    WINDOW_SLIDE_AMOUNT: WINDOW_SLIDE_AMOUNT,
    WINDOW_DETACH_MASS: WINDOW_DETACH_MASS,
    WINDOW_DETACH_MAX_PER_EVENT: WINDOW_DETACH_MAX_PER_EVENT,
    WINDOW_VELOCITY_INHERIT: WINDOW_VELOCITY_INHERIT,
    DETACHED_GRAVITY: DETACHED_GRAVITY,
    DETACHED_LIFT: DETACHED_LIFT,
    WINDOW_MEDIUM_DEPTH: WINDOW_MEDIUM_DEPTH,
    WINDOW_HEAVY_DEPTH: WINDOW_HEAVY_DEPTH,
    WINDOW_MEDIUM_MASS: WINDOW_MEDIUM_MASS,
    WINDOW_HEAVY_MASS: WINDOW_HEAVY_MASS,
    WINDOW_CHUNK_CHANCE: WINDOW_CHUNK_CHANCE,
    WINDOW_SHED_KICK: WINDOW_SHED_KICK,
    PLOW_SPAWN_DEPTH: PLOW_SPAWN_DEPTH,
    PLOW_DESPAWN_DEPTH: PLOW_DESPAWN_DEPTH,
    PLOW_COOLDOWN_SECONDS: PLOW_COOLDOWN_SECONDS,
    PLOW_CAPACITY: PLOW_CAPACITY,
    PLOW_SPEED: PLOW_SPEED,
    PLOW_LOADED_SPEED_FACTOR: PLOW_LOADED_SPEED_FACTOR,
    PLOW_SCOOP_RADIUS: PLOW_SCOOP_RADIUS,
    PLOW_SCOOP_AMOUNT: PLOW_SCOOP_AMOUNT,
    PLOW_UNLOAD_SECONDS: PLOW_UNLOAD_SECONDS,
    PLOW_DUST_EVERY: PLOW_DUST_EVERY,
    PLOW_SNOWMAN_MARGIN: PLOW_SNOWMAN_MARGIN,
    PLOW_TRACK_RADIUS: PLOW_TRACK_RADIUS,
    PLOW_TRACK_STRENGTH: PLOW_TRACK_STRENGTH,
    AVALANCHE_MIN_DEPTH: AVALANCHE_MIN_DEPTH,
    AVALANCHE_CHANCE_PER_SECOND: AVALANCHE_CHANCE_PER_SECOND,
    AVALANCHE_COOLDOWN_SECONDS: AVALANCHE_COOLDOWN_SECONDS,
    AVALANCHE_SLIDE_AMOUNT: AVALANCHE_SLIDE_AMOUNT,
    AVALANCHE_SHED_MASS: AVALANCHE_SHED_MASS,
    AVALANCHE_CHECK_SECONDS: AVALANCHE_CHECK_SECONDS,
    SETTLE_ROLL_STEPS: SETTLE_ROLL_STEPS,
    SETTLE_ROLL_GAIN: SETTLE_ROLL_GAIN,
    SETTLE_COMPACT_AMOUNT: SETTLE_COMPACT_AMOUNT,
    SETTLE_SINK_FRACTION: SETTLE_SINK_FRACTION,
    ADAPTIVE_BUDGET_MS: ADAPTIVE_BUDGET_MS,
    ADAPTIVE_RECOVER_MS: ADAPTIVE_RECOVER_MS,
    ADAPTIVE_STEP: ADAPTIVE_STEP,
    ADAPTIVE_MIN_SCALE: ADAPTIVE_MIN_SCALE,
    ADAPTIVE_MAX_SCALE: ADAPTIVE_MAX_SCALE,
    ADAPTIVE_CHECK_MS: ADAPTIVE_CHECK_MS,
    OVERLAY_NAMESPACE: OVERLAY_NAMESPACE,
    OVERLAY_MODES: OVERLAY_MODES,
    LAYERS: LAYERS,
    STATE_VERSION: STATE_VERSION,
    MAX_STATE_BYTES: MAX_STATE_BYTES
  };
}
