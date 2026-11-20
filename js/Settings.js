// Snowglobe preferences: defaults, validation and coercion.
//
// One store, owned by the host: the plugin's inline entry in
// ~/.config/omarchy/shell.json. This module never writes that file — the caller
// hands a normalized entry to shell.updateEntryInline() — and it never throws on
// bad input: an invalid value falls back to its default rather than taking the
// widget down.
//
// Self-contained on purpose: QML JavaScript cannot import other JavaScript
// files, so the enums below are the authoritative copy for preferences.

var DEFAULTS = {
  enabled: true,
  overlay: "passive",
  layer: "behind",
  quality: "balanced",
  density: 1,
  wind: 1,
  accumulateOnWindows: true,
  builderEnabled: true
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
  return {
    enabled: bool(src.enabled, DEFAULTS.enabled),
    overlay: oneOf(src.overlay, OVERLAY_MODES, DEFAULTS.overlay),
    layer: oneOf(src.layer, LAYERS, DEFAULTS.layer),
    quality: oneOf(src.quality, QUALITIES, DEFAULTS.quality),
    density: number(src.density, DEFAULTS.density, DENSITY_MIN, DENSITY_MAX),
    wind: number(src.wind, DEFAULTS.wind, WIND_MIN, WIND_MAX),
    accumulateOnWindows: bool(src.accumulateOnWindows, DEFAULTS.accumulateOnWindows),
    builderEnabled: bool(src.builderEnabled, DEFAULTS.builderEnabled)
  };
}

// shell.json stores the settings inline in the widget's layout entry, keyed by
// id, so the entry handed to updateEntryInline must keep the id.
function toEntry(raw, id) {
  var entry = normalize(raw);
  entry.id = String(id || "");
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
    toEntry: toEntry,
    overlayWanted: overlayWanted
  };
}
