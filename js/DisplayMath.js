// Display coordinate helpers for Snowglobe.
//
// Pure JavaScript so the same conversions can be unit-tested with synthetic
// monitors of any resolution, scale and origin — including setups that are not
// physically available on the development machine.

function safeScale(scale) {
  return typeof scale === "number" && isFinite(scale) && scale > 0 ? scale : 1;
}

// Hyprland transforms 1, 3, 5 and 7 rotate the output by 90 or 270 degrees
// (5 and 7 are the flipped variants). The reported mode width/height are the
// unrotated panel size, so a portrait monitor has to swap them.
function isRotated(transform) {
  var t = Number(transform);
  return isFinite(t) && (Math.round(t) % 2) === 1;
}

// Hyprland reports monitor width/height in physical pixels of the unrotated
// mode; the simulation and the QML surfaces work in logical pixels of the
// screen as the user sees it.
function logicalSize(physicalWidth, physicalHeight, scale, transform) {
  var s = safeScale(scale);
  var w = (physicalWidth || 0) / s;
  var h = (physicalHeight || 0) / s;
  return isRotated(transform) ? { width: h, height: w } : { width: w, height: h };
}

function reservedArea(reserved, scale) {
  var s = safeScale(scale);
  // Hyprland's IPC arrays reach QML as QVariantList: array-like (length and
  // index access work) but Array.isArray() is false. Testing for a JS Array
  // silently discarded the panel's reserved area, so the ground line sat under
  // the bar and snow piled where it could not be seen.
  var r = reserved && typeof reserved.length === "number" && reserved.length >= 4
    ? [Number(reserved[0]), Number(reserved[1]), Number(reserved[2]), Number(reserved[3])]
    : [0, 0, 0, 0];
  return {
    left: (r[0] || 0) / s,
    top: (r[1] || 0) / s,
    right: (r[2] || 0) / s,
    bottom: (r[3] || 0) / s
  };
}

function toLocal(globalX, globalY, monitor) {
  return {
    x: (globalX || 0) - (monitor.x || 0),
    y: (globalY || 0) - (monitor.y || 0)
  };
}

function toGlobal(localX, localY, monitor) {
  return {
    x: (localX || 0) + (monitor.x || 0),
    y: (localY || 0) + (monitor.y || 0)
  };
}

function contains(monitor, globalX, globalY) {
  var size = logicalSize(monitor.width, monitor.height, monitor.scale, monitor.transform);
  var local = toLocal(globalX, globalY, monitor);
  return local.x >= 0 && local.y >= 0 && local.x <= size.width && local.y <= size.height;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    safeScale: safeScale,
    isRotated: isRotated,
    logicalSize: logicalSize,
    reservedArea: reservedArea,
    toLocal: toLocal,
    toGlobal: toGlobal,
    contains: contains
  };
}
