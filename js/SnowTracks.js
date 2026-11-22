// Bounded pressed-snow tracks for Snowglobe.
//
// Pure JavaScript with parallel typed arrays, like ParticleSystem: one bounded
// store per monitor, no QML objects and no allocation during animation. Rolling
// snowballs stamp it today; the snow plow will reuse the same store later, so
// there is only one track system.
//
// `strength` fades with time and a little faster while snow is still falling,
// which reads as fresh snow gradually covering the impressions.

var DEFAULT_CAPACITY = 192;
var FADE_PER_SECOND = 0.16;       // about six seconds from fresh to gone
var BURY_PER_DENSITY = 0.05;      // extra fade while snowfall continues

function create(capacity) {
  var cap = Math.max(1, Math.floor(capacity || DEFAULT_CAPACITY));
  return {
    capacity: cap,
    count: 0,
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    radius: new Float32Array(cap),
    strength: new Float32Array(cap)
  };
}

function stamp(tracks, x, y, radius, strength) {
  if (!tracks) return -1;
  var slot = -1;
  for (var k = 0; k < tracks.capacity; k++) {
    if (tracks.strength[k] <= 0) { slot = k; break; }
  }
  if (slot < 0) return -1; // all slots still alive: keep the oldest impressions
  var wasEmpty = tracks.strength[slot] <= 0;
  tracks.x[slot] = x;
  tracks.y[slot] = y;
  tracks.radius[slot] = Math.max(1, radius);
  tracks.strength[slot] = Math.max(0.05, Math.min(1, strength === undefined ? 0.6 : strength));
  if (wasEmpty) tracks.count++;
  return slot;
}

function update(tracks, dt, fadeRate, buryRate) {
  if (!tracks || !(dt > 0)) return 0;
  var fade = (fadeRate === undefined ? FADE_PER_SECOND : fadeRate)
    + (buryRate === undefined ? 0 : buryRate);
  var decay = Math.min(dt, 0.1) * Math.max(0, fade);
  var active = 0;
  for (var i = 0; i < tracks.capacity; i++) {
    if (tracks.strength[i] <= 0) continue;
    tracks.strength[i] = Math.max(0, tracks.strength[i] - decay);
    if (tracks.strength[i] > 0) active++;
  }
  tracks.count = active;
  return active;
}

function clear(tracks) {
  if (!tracks) return;
  tracks.strength.fill(0);
  tracks.count = 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CAPACITY: DEFAULT_CAPACITY,
    FADE_PER_SECOND: FADE_PER_SECOND,
    BURY_PER_DENSITY: BURY_PER_DENSITY,
    create: create,
    stamp: stamp,
    update: update,
    clear: clear
  };
}
