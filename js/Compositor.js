// Compositor capability checks for Snowglobe.
//
// Pure JavaScript, no Qt and no Hyprland: Service.qml runs `hyprctl` and hands
// the raw text to these functions, so the decision logic is unit-testable.
//
// Why this exists: Snowglobe draws on one full-screen, transparent layer
// surface per monitor. Transparency only works when the compositor offers the
// client an alpha-capable buffer format (AR24 and friends). Hyprland 0.57.0
// turned `quirks:skip_non_kms_dmabuf_formats` on by default, which filters the
// offered formats down to what the display plane can scan out. On virtio-gpu
// (VMs) and older Intel GPUs that leaves no alpha format at all: the Qt Quick
// surface is created as XR24, its transparent pixels become opaque black, and
// a full-screen overlay hides the whole desktop. Hyprland 0.57.1 restored the
// default to false, but a stale config or an unupdated session still hits it.
//
// Snowglobe cannot change the buffer format from inside the client, so the
// only safe thing it can do is not map a full-screen surface when the
// compositor is known to strip alpha, and say why.

var QUIRK_OPTION = "quirks:skip_non_kms_dmabuf_formats";

// Probe results. "unknown" means "could not tell" (no hyprctl, an older
// Hyprland without the option, unparsable output) and is treated as safe:
// refusing to draw on every system we cannot inspect would be worse.
var SAFE = "safe";
var UNSAFE = "unsafe";
var UNKNOWN = "unknown";
var CHECKING = "checking";

function truthy(value) {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    var v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "on";
  }
  return false;
}

// Parse the output of `hyprctl -j getoption quirks:skip_non_kms_dmabuf_formats`.
// Hyprland prints e.g. {"option":"...","int":1,"set":false}; depending on the
// version a bool can also appear as "bool" or "str". A non-JSON answer such as
// "no such option" means the option does not exist, i.e. an older Hyprland
// that never filtered formats.
function parseQuirkProbe(text) {
  var raw = String(text === undefined || text === null ? "" : text).trim();
  if (raw.length === 0) return { state: UNKNOWN, reason: "no output" };
  var doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    if (/no such option|unknown option|option not found/i.test(raw))
      return { state: SAFE, reason: "option not present" };
    return { state: UNKNOWN, reason: "unparsable output" };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc))
    return { state: UNKNOWN, reason: "unexpected output" };
  var value;
  if ("bool" in doc) value = doc.bool;
  else if ("int" in doc) value = doc.int;
  else if ("str" in doc) value = doc.str;
  else if ("value" in doc) value = doc.value;
  else return { state: UNKNOWN, reason: "option has no value" };
  if (truthy(value))
    return { state: UNSAFE, reason: QUIRK_OPTION + " is enabled" };
  return { state: SAFE, reason: QUIRK_OPTION + " is disabled" };
}

// Whether the overlay may be mapped for a probe state and the user's guard
// setting. While a probe is still running nothing is mapped, so a black frame
// can never flash up before the answer arrives.
function overlayAllowed(state, guardEnabled) {
  if (guardEnabled === false) return true;
  return state === SAFE || state === UNKNOWN;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    QUIRK_OPTION: QUIRK_OPTION,
    SAFE: SAFE,
    UNSAFE: UNSAFE,
    UNKNOWN: UNKNOWN,
    CHECKING: CHECKING,
    parseQuirkProbe: parseQuirkProbe,
    overlayAllowed: overlayAllowed
  };
}
