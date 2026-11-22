// Snowglobe preferences: defaults, validation and coercion.
//
// One store, owned by the host: the plugin's inline entry in shell.json. This
// module never writes that file — the caller hands a normalized entry to
// shell.updateEntryInline() — and it never throws on bad input: an invalid
// value falls back to its default rather than taking the widget down.
//
// Self-contained on purpose: QML JavaScript cannot import other JavaScript
// files, so the enums below are the authoritative copy for preferences.

var SCHEMA_VERSION = 1;

// Bumped when a default changes meaning. BarWidget writes every key back into
// shell.json, so an old install has "layer": "behind" stored explicitly even
// though the user never chose it. Entries that predate this revision get the
// new default for the keys listed in `migrateLegacy` once; after the next write
// the revision is stored and the user's own choice is respected again.
var SETTINGS_REVISION = 2;

var DEFAULTS = {
  enabled: true,
  overlay: "passive",
  layer: "above",
  quality: "balanced",
  density: 1,
  wind: 1,
  accumulateOnWindows: true,
  builderEnabled: true,
  adaptiveQuality: true,
  pauseOnFullscreen: true,
  plowEnabled: true
};

var OVERLAY_MODES = ["passive", "disabled"];
var LAYERS = ["behind", "above"];
var QUALITIES = ["low", "balanced", "high"];

var DENSITY_MIN = 0.2;
var DENSITY_MAX = 3;
var WIND_MIN = -2;
var WIND_MAX = 2;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function number(value, fallback, min, max) {
  var n = typeof value === "number" ? value : NaN;
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

// Always returns a complete, valid settings object. Unknown keys are dropped so
// a stale key from an older version cannot leak back into shell.json.
function normalize(raw) {
  var src = isPlainObject(raw) ? raw : {};
  // "behind" draws under every window, so snow disappears behind the very
  // windows it is meant to settle on. It was the stored default of revision 1.
  var legacy = src.settingsRevision !== SETTINGS_REVISION;
  return {
    enabled: bool(src.enabled, DEFAULTS.enabled),
    overlay: oneOf(src.overlay, OVERLAY_MODES, DEFAULTS.overlay),
    layer: legacy ? DEFAULTS.layer : oneOf(src.layer, LAYERS, DEFAULTS.layer),
    quality: oneOf(src.quality, QUALITIES, DEFAULTS.quality),
    density: number(src.density, DEFAULTS.density, DENSITY_MIN, DENSITY_MAX),
    wind: number(src.wind, DEFAULTS.wind, WIND_MIN, WIND_MAX),
    accumulateOnWindows: bool(src.accumulateOnWindows, DEFAULTS.accumulateOnWindows),
    builderEnabled: bool(src.builderEnabled, DEFAULTS.builderEnabled),
    adaptiveQuality: bool(src.adaptiveQuality, DEFAULTS.adaptiveQuality),
    pauseOnFullscreen: bool(src.pauseOnFullscreen, DEFAULTS.pauseOnFullscreen),
    plowEnabled: bool(src.plowEnabled, DEFAULTS.plowEnabled)
  };
}

// Migration hook. There is only schema version 1 today: an entry with no
// version is accepted, a future version is reported rather than silently
// rewritten, and unknown keys are accounted for so diagnostics stay honest.
// Returns { settings, migrated, dropped, reason }.
function migrate(raw) {
  var src = isPlainObject(raw) ? raw : {};
  var dropped = [];
  for (var key in src) if (!(key in DEFAULTS) && key !== "id" && key !== "version" && key !== "settingsRevision") dropped.push(key);
  var reason = "";
  if (src.version !== undefined && src.version !== SCHEMA_VERSION)
    reason = "unsupported settings version: " + String(src.version);
  var result = { settings: normalize(src), migrated: dropped.length > 0, dropped: dropped, reason: reason };
  return result;
}

// shell.json stores the settings inline in the widget's layout entry, keyed by
// id, so the entry handed to updateEntryInline must keep the id.
function toEntry(raw, id) {
  // The caller passes values that already went through normalize(); stamping
  // the revision marks them as deliberate so a stored "behind" survives.
  var base = isPlainObject(raw) ? raw : {};
  var entry = normalize({
    enabled: base.enabled, overlay: base.overlay, layer: base.layer,
    quality: base.quality, density: base.density, wind: base.wind,
    accumulateOnWindows: base.accumulateOnWindows, builderEnabled: base.builderEnabled,
    adaptiveQuality: base.adaptiveQuality, pauseOnFullscreen: base.pauseOnFullscreen,
    settingsRevision: SETTINGS_REVISION
  });
  entry.id = String(id || "");
  entry.settingsRevision = SETTINGS_REVISION;
  return entry;
}

// Whether the overlay should hold a surface for these settings. `disabled`
// means no surface at all, which is the whole point of the mode.
function overlayWanted(settings) {
  var s = normalize(settings);
  return s.enabled && s.overlay === "passive";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    SETTINGS_REVISION: SETTINGS_REVISION,
    DEFAULTS: DEFAULTS,
    OVERLAY_MODES: OVERLAY_MODES,
    LAYERS: LAYERS,
    QUALITIES: QUALITIES,
    DENSITY_MIN: DENSITY_MIN,
    DENSITY_MAX: DENSITY_MAX,
    WIND_MIN: WIND_MIN,
    WIND_MAX: WIND_MAX,
    isPlainObject: isPlainObject,
    normalize: normalize,
    migrate: migrate,
    toEntry: toEntry,
    overlayWanted: overlayWanted
  };
}
