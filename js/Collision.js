// Flake-to-surface intersection tests and surface geometry.
//
// Pure JavaScript and module-agnostic: the SnowBank module is passed in so
// this file stays self-contained for QML's JavaScript engine. Only surfaces
// whose horizontal span contains the flake are considered, so cost scales with
// the number of surfaces, not with every particle on every surface.

// Snow can only rest where it is actually visible and free: a segment that is
// covered by another window, hidden under the panel or has no room above it is
// "not landable" and flakes simply fall past it.
function landingSurface(bankModule, surfaces, system, index, nextX, nextY, radius, tolerance) {
  // Some flakes are only decoration: they fall visibly across windows and the
  // whole screen without settling. Without this every flake would be consumed
  // by the first window edge it meets and no snow would ever be seen in front
  // of a window's body.
  if (system.settle && system.settle[index] === 0) return null
  var prevBottom = system.y[index] + radius
  var nextBottom = nextY + radius
  var slack = tolerance === undefined ? 2 : tolerance
  var best = null
  var bestTop = Infinity

  for (var i = 0; i < surfaces.length; i++) {
    var surface = surfaces[i]
    if (!surface || !surface.bank) continue
    if (nextX < surface.x || nextX > surface.x + surface.width) continue
    if (!bankModule.landable(surface.bank, nextX)) continue
    var top = bankModule.surfaceTopAt(surface.bank, nextX)
    // The flake must have been above the surface and must now reach it. The
    // small tolerance avoids tunnelling through a surface on a fast step.
    if (prevBottom > top + slack) continue
    if (nextBottom < top) continue
    if (top >= bestTop) continue
    best = surface
    bestTop = top
  }
  return best
}

function topAt(bankModule, surfaces, x) {
  var best = Infinity
  for (var i = 0; i < surfaces.length; i++) {
    var surface = surfaces[i]
    if (!surface || !surface.bank) continue
    if (x < surface.x || x > surface.x + surface.width) continue
    if (!bankModule.landable(surface.bank, x)) continue
    var top = bankModule.surfaceTopAt(surface.bank, x)
    if (top < best) best = top
  }
  return best
}

// First landable surface at or below `y` (smallest top that is not above it).
// `slack` lets a point slightly inside the snow still count as "on" the surface.
// Returns { surface, top } or null.
function surfaceBelow(bankModule, surfaces, x, y, slack) {
  var allow = slack === undefined ? 0 : slack
  var best = null
  var bestTop = Infinity
  for (var i = 0; i < surfaces.length; i++) {
    var surface = surfaces[i]
    if (!surface || !surface.bank) continue
    if (x < surface.x || x > surface.x + surface.width) continue
    if (!bankModule.landable(surface.bank, x)) continue
    var top = bankModule.surfaceTopAt(surface.bank, x)
    if (top < y - allow) continue
    if (top < bestTop) {
      bestTop = top
      best = surface
    }
  }
  return best ? { surface: best, top: bestTop } : null
}

// ---- Stacking order -------------------------------------------------------
// Hyprland does not report a z-order, but it is derivable well enough for
// snow: special-workspace windows sit above everything, floating windows above
// tiled ones, and within a class the most recently focused window is on top.
// A larger rank means "closer to the viewer".
function windowRank(win) {
  var focus = typeof win.focusRank === "number" && isFinite(win.focusRank) ? win.focusRank : 0
  return (win.special === true ? 2000000 : 0) + (win.floating === true ? 1000000 : 0) - focus
}

// ---- Headroom / occlusion ---------------------------------------------------
// Compute the per-segment limit for one surface.
//
//   spec     { type: "ground"|"window", id, x, y, width }   (monitor-local px)
//   segW     segment width in px, `segments` the segment count
//   maxDepth the most this surface may ever hold
//   env      { width, ceiling, windows: [ { id, x, y, width, height, rank } ] }
//            `ceiling` is the lowest y snow may reach upward (panel bottom).
//
// A segment's limit is:
//   0                         off-screen, or hidden behind a window that is in
//                             front of this surface, or no room above it
//   headroom - margin         free space up to the nearest window bottom or the
//                             panel, whichever is closer, capped by maxDepth
//
// This is what keeps snow from piling over another window's content or under
// the panel when the overlay is drawn above windows.
var HEADROOM_MARGIN = 1
var COVER_EPSILON = 0.5

function surfaceLimits(spec, segW, segments, maxDepth, env) {
  var limits = new Float32Array(segments)
  var ceilingAt = new Float32Array(segments)
  var covered = new Uint8Array(segments)
  var base = spec.y
  var monitorWidth = env.width
  var selfRank = spec.type === "window" ? spec.rank : -Infinity
  var i

  for (i = 0; i < segments; i++) {
    var cx = spec.x + (i + 0.5) * segW
    ceilingAt[i] = env.ceiling
    // Off-screen segments are not visible: never let snow collect there.
    if (cx < 0 || cx > monitorWidth) covered[i] = 1
  }

  var windows = env.windows || []
  for (var w = 0; w < windows.length; w++) {
    var other = windows[w]
    if (spec.type === "window" && other.id === spec.id) continue
    var first = Math.max(0, Math.ceil((other.x - spec.x) / segW - 0.5))
    var last = Math.min(segments - 1, Math.ceil((other.x + other.width - spec.x) / segW - 0.5) - 1)
    if (last < first) continue
    var bottom = other.y + other.height
    // The window spans the surface line. For the ground that always hides it.
    // For another window it hides this one only when it is in front of it.
    var spansLine = other.y <= base + COVER_EPSILON && bottom > base + COVER_EPSILON
    if (spansLine) {
      var inFront = spec.type === "ground" || other.rank > selfRank
      if (inFront) {
        for (i = first; i <= last; i++) covered[i] = 1
      }
      continue
    }
    // Entirely above the line: it becomes the ceiling for the snow beneath it.
    if (bottom <= base + COVER_EPSILON) {
      for (i = first; i <= last; i++)
        if (bottom > ceilingAt[i]) ceilingAt[i] = bottom
    }
  }

  for (i = 0; i < segments; i++) {
    if (covered[i]) { limits[i] = 0; continue }
    var room = base - ceilingAt[i] - HEADROOM_MARGIN
    limits[i] = room < 0 ? 0 : Math.min(maxDepth, room)
  }
  return limits
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    landingSurface: landingSurface,
    topAt: topAt,
    surfaceBelow: surfaceBelow,
    windowRank: windowRank,
    surfaceLimits: surfaceLimits,
    HEADROOM_MARGIN: HEADROOM_MARGIN
  };
}
