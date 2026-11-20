// Snowglobe's own state document, kept outside shell.json.
//
// shell.json owns preferences and is written by the host; this file owns the
// things that are not preferences and would bloat it — saved snowmen and a
// little diagnostics. Quickshell's FileView does the IO with atomicWrites; this
// module is the whole of the read/validate/serialize logic so it can be tested
// without a desktop.
//
// The rule the code depends on: a document that does not validate is never
// partially applied and never overwritten. The caller quarantines the old file
// and starts from empty().

var STATE_VERSION = 1;
var MAX_SNOWMEN = 64;
var MAX_MONITOR_NAME = 64;

var SCALE_MIN = 0.25;
var SCALE_MAX = 4;

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

// A snowman is data, not a scene object: one monitor, a monitor-local anchor, a
// scale and a creation time. Anything missing or out of range invalidates the
// entry, and an invalid entry invalidates the document — dropping snowmen
// silently would be worse than quarantining the file.
function normalizeSnowman(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) return null;
  if (typeof raw.monitor !== "string" || raw.monitor.length === 0 || raw.monitor.length > MAX_MONITOR_NAME) return null;
  if (!boundedNumber(raw.x, -100000, 100000)) return null;
  if (!boundedNumber(raw.y, -100000, 100000)) return null;
  if (!boundedNumber(raw.scale, SCALE_MIN, SCALE_MAX)) return null;
  if (!isFiniteNumber(raw.createdAt) || raw.createdAt < 0) return null;
  return {
    id: raw.id,
    monitor: raw.monitor,
    x: raw.x,
    y: raw.y,
    scale: raw.scale,
    createdAt: raw.createdAt
  };
}

// Returns { ok, state, reason }. `state` is a fresh object, never a view into
// `doc`, so a failed parse cannot leave a half-mutated document in use.
function normalize(doc) {
  if (!isPlainObject(doc)) return { ok: false, state: empty(), reason: "not an object" };
  if (doc.version !== STATE_VERSION)
    return { ok: false, state: empty(), reason: "unsupported version: " + String(doc.version) };
  if (!Array.isArray(doc.snowmen))
    return { ok: false, state: empty(), reason: "snowmen is not an array" };
  if (doc.snowmen.length > MAX_SNOWMEN)
    return { ok: false, state: empty(), reason: "too many snowmen: " + doc.snowmen.length };

  var snowmen = [];
  for (var i = 0; i < doc.snowmen.length; i++) {
    var one = normalizeSnowman(doc.snowmen[i]);
    if (!one) return { ok: false, state: empty(), reason: "invalid snowman at index " + i };
    snowmen.push(one);
  }

  var savedAt = isFiniteNumber(doc.savedAt) && doc.savedAt >= 0 ? doc.savedAt : 0;
  return { ok: true, state: { version: STATE_VERSION, snowmen: snowmen, savedAt: savedAt }, reason: "" };
}

function parse(text) {
  if (typeof text !== "string" || text.length === 0)
    return { ok: false, state: empty(), reason: "empty document" };
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
    empty: empty,
    isPlainObject: isPlainObject,
    normalizeSnowman: normalizeSnowman,
    normalize: normalize,
    parse: parse,
    serialize: serialize
  };
}
