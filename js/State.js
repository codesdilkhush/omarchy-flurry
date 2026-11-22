// Snowglobe's own state document, kept outside shell.json.
//
// shell.json owns preferences; this file owns persistent decorations. Quickshell's
// FileView does the IO with atomicWrites; this module is the whole of the
// read/validate/migrate/serialize logic so it can be tested without a desktop.
//
// Rule: a document that does not validate is never partially applied and never
// overwritten. The caller quarantines it before starting from empty().

var STATE_VERSION = 2;
var MAX_SNOWMEN = 64;
var MAX_MONITOR_NAME = 64;
var MAX_TEXT_BYTES = 256 * 1024;
var MAX_BALLS = 6;
var MAX_DECORATIONS = 24;

var SCALE_MIN = 0.25;
var SCALE_MAX = 4;
var RADIUS_MIN = 6;
var RADIUS_MAX = 160;
var COORD_LIMIT = 100000;

var DECORATION_TYPES = ["carrot", "eyes", "arms", "hat", "scarf", "buttons", "mouth"];

function empty() {
  return { version: STATE_VERSION, snowmen: [], savedAt: 0 };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function boundedNumber(value, min, max) {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function normalizeBall(raw) {
  if (!isPlainObject(raw)) return null;
  if (!boundedNumber(raw.x, -COORD_LIMIT, COORD_LIMIT)) return null;
  if (!boundedNumber(raw.y, -COORD_LIMIT, COORD_LIMIT)) return null;
  if (!boundedNumber(raw.r, RADIUS_MIN, RADIUS_MAX)) return null;
  return { x: raw.x, y: raw.y, r: raw.r };
}

function normalizeDecoration(raw, ballCount) {
  if (!isPlainObject(raw)) return null;
  if (DECORATION_TYPES.indexOf(raw.type) < 0) return null;
  if (typeof raw.ballIndex !== "number" || !isFinite(raw.ballIndex)
    || Math.floor(raw.ballIndex) !== raw.ballIndex
    || raw.ballIndex < 0 || raw.ballIndex >= ballCount) return null;
  if (!boundedNumber(raw.dx, -400, 400) || !boundedNumber(raw.dy, -400, 400)) return null;
  if (!boundedNumber(raw.rotation, -720, 720)) return null;
  if (!boundedNumber(raw.scale, SCALE_MIN, SCALE_MAX)) return null;
  return {
    type: raw.type,
    ballIndex: raw.ballIndex,
    dx: raw.dx,
    dy: raw.dy,
    rotation: raw.rotation,
    scale: raw.scale
  };
}

// A snowman is data, not a scene object. Every field is validated: silently
// dropping a malformed entry would hide corruption instead of quarantining it.
function normalizeSnowman(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) return null;
  if (typeof raw.monitor !== "string" || raw.monitor.length === 0 || raw.monitor.length > MAX_MONITOR_NAME) return null;
  if (!boundedNumber(raw.x, -COORD_LIMIT, COORD_LIMIT)) return null;
  if (!boundedNumber(raw.y, -COORD_LIMIT, COORD_LIMIT)) return null;
  if (!boundedNumber(raw.scale, SCALE_MIN, SCALE_MAX)) return null;
  if (!boundedNumber(raw.rotation, -360, 360)) return null;
  if (!isFiniteNumber(raw.createdAt) || raw.createdAt < 0) return null;
  if (!Array.isArray(raw.balls) || raw.balls.length === 0 || raw.balls.length > MAX_BALLS) return null;

  var balls = [];
  for (var i = 0; i < raw.balls.length; i++) {
    var ball = normalizeBall(raw.balls[i]);
    if (!ball) return null;
    balls.push(ball);
  }
  var decorations = raw.decorations === undefined ? [] : raw.decorations;
  if (!Array.isArray(decorations) || decorations.length > MAX_DECORATIONS) return null;
  var parsedDecorations = [];
  for (var d = 0; d < decorations.length; d++) {
    var decoration = normalizeDecoration(decorations[d], balls.length);
    if (!decoration) return null;
    parsedDecorations.push(decoration);
  }

  return {
    id: raw.id,
    monitor: raw.monitor,
    x: raw.x,
    y: raw.y,
    scale: raw.scale,
    rotation: raw.rotation,
    createdAt: raw.createdAt,
    balls: balls,
    decorations: parsedDecorations
  };
}

// Version 1 stored only an anchor and scale. Rebuild a sensible three-ball
// stack from that anchor instead of discarding the user's snowman.
function migrateV1(raw) {
  var scale = boundedNumber(raw.scale, SCALE_MIN, SCALE_MAX) ? raw.scale : 1;
  var radii = [42 * scale, 32 * scale, 24 * scale];
  var balls = [];
  var offset = 0;
  for (var i = 0; i < radii.length; i++) {
    balls.push({
      x: raw.x + (i === 1 ? 0 : 0),
      y: raw.y - offset - radii[i],
      r: radii[i]
    });
    offset += radii[i] + radii[Math.min(i + 1, radii.length - 1)];
  }
  return {
    id: raw.id,
    monitor: raw.monitor,
    x: raw.x,
    y: raw.y,
    scale: scale,
    rotation: 0,
    createdAt: raw.createdAt,
    balls: balls,
    decorations: []
  };
}

// Returns { ok, state, reason }. `state` is always a fresh object.
function normalize(doc) {
  if (!isPlainObject(doc)) return { ok: false, state: empty(), reason: "not an object" };
  var version = doc.version;
  if (version !== 1 && version !== STATE_VERSION)
    return { ok: false, state: empty(), reason: "unsupported version: " + String(version) };
  if (!Array.isArray(doc.snowmen))
    return { ok: false, state: empty(), reason: "snowmen is not an array" };
  if (doc.snowmen.length > MAX_SNOWMEN)
    return { ok: false, state: empty(), reason: "too many snowmen: " + doc.snowmen.length };

  var snowmen = [];
  for (var i = 0; i < doc.snowmen.length; i++) {
    var source = version === 1 ? migrateV1(doc.snowmen[i]) : doc.snowmen[i];
    var one = normalizeSnowman(source);
    if (!one) return { ok: false, state: empty(), reason: "invalid snowman at index " + i };
    snowmen.push(one);
  }

  var savedAt = isFiniteNumber(doc.savedAt) && doc.savedAt >= 0 ? doc.savedAt : 0;
  return {
    ok: true,
    state: { version: STATE_VERSION, snowmen: snowmen, savedAt: savedAt },
    reason: version === 1 ? "migrated from version 1" : ""
  };
}

function parse(text) {
  if (typeof text !== "string" || text.length === 0)
    return { ok: false, state: empty(), reason: "empty document" };
  if (text.length > MAX_TEXT_BYTES)
    return { ok: false, state: empty(), reason: "document too large" };
  var doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, state: empty(), reason: "invalid JSON" };
  }
  return normalize(doc);
}

function serialize(state) {
  var checked = normalize(state);
  var doc = checked.ok ? checked.state : empty();
  return JSON.stringify(doc, null, 2) + "\n";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATE_VERSION: STATE_VERSION,
    MAX_SNOWMEN: MAX_SNOWMEN,
    MAX_TEXT_BYTES: MAX_TEXT_BYTES,
    MAX_BALLS: MAX_BALLS,
    MAX_DECORATIONS: MAX_DECORATIONS,
    DECORATION_TYPES: DECORATION_TYPES,
    empty: empty,
    isPlainObject: isPlainObject,
    normalizeBall: normalizeBall,
    normalizeSnowman: normalizeSnowman,
    migrateV1: migrateV1,
    normalize: normalize,
    parse: parse,
    serialize: serialize
  };
}
