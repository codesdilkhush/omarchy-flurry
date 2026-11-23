// Compact snow accumulation representation.
//
// A bank is a height map over one horizontal surface (a monitor bottom or a
// window top). Each segment stores a depth in logical pixels, capped by
// MAX_DEPTH. Nothing is stored per flake: landing flakes only raise a few
// segments. The representation is bounded, cheap to scan and easy to test.
//
// Pure JavaScript with no imports: all limits are passed in at creation.

function create(id, type, x, y, width, segmentWidth, maxDepth) {
  var segW = Math.max(1, segmentWidth || 2)
  var segs = Math.max(1, Math.ceil(Math.max(1, width) / segW))
  return {
    id: String(id || ""),
    type: type === "ground" ? "ground" : "window",
    x: x,
    y: y,
    width: Math.max(0, width),
    segmentWidth: segW,
    segments: segs,
    maxDepth: Math.max(1, maxDepth || 255),
    // Per-segment ceiling. `maxDepth` is the most a surface may ever hold; the
    // actual limit of a segment is lower wherever another window, the panel or
    // the screen edge leaves less free space above it (see Collision.js). A
    // limit of zero means "not landable": covered, off-screen or no headroom.
    limit: (function() {
      var l = new Float32Array(segs)
      l.fill(Math.max(1, maxDepth || 255))
      return l
    })(),
    // Float32 avoids integer truncation: fractional deposits, sliding and
    // melting must accumulate smoothly. Memory is still bounded by `segs`.
    heights: new Float32Array(segs),
    revision: 0,
    changed: false
  }
}

function indexAt(bank, x) {
  var i = Math.floor((x - bank.x) / bank.segmentWidth)
  if (i < 0) return 0
  if (i >= bank.segments) return bank.segments - 1
  return i
}

function heightAt(bank, x) {
  return bank.heights[indexAt(bank, x)]
}

function surfaceTopAt(bank, x) {
  return bank.y - heightAt(bank, x)
}

// Add a landed flake. `spread` controls how many neighbouring segments share
// the deposit, producing a soft mound rather than a single spike.
function deposit(bank, x, amount, spread) {
  var centre = indexAt(bank, x)
  var reach = Math.max(0, Math.floor(spread || 0))
  var added = false
  for (var offset = -reach; offset <= reach; offset++) {
    var idx = centre + offset
    if (idx < 0 || idx >= bank.segments) continue
    var weight = 1 - Math.abs(offset) / (reach + 1)
    var value = amount * weight
    if (value <= 0) continue
    var next = Math.min(bank.limit[idx], bank.heights[idx] + value)
    if (next !== bank.heights[idx]) {
      bank.heights[idx] = next
      added = true
    }
  }
  if (added) bank.revision++
  return added
}

// Move a little snow downwind. Iterating from the downwind edge prevents a
// single cell from hopping several segments in one call.
//
// `shedAtEdge` makes snow blow off the downwind end instead of stacking there.
// Without it a steady wind carries every flake to the last segment and builds
// a tall pillar at the edge of a window or screen.
function slide(bank, direction, amount, shedAtEdge) {
  var move = Math.max(0, amount)
  if (move === 0) return false
  var moved = false
  if (direction >= 0) {
    for (var i = bank.segments - 2; i >= 0; i--) {
      var take = Math.min(bank.heights[i], move)
      if (take <= 0) continue
      var room = bank.limit[i + 1] - bank.heights[i + 1]
      var give = Math.min(take, room)
      if (give <= 0) continue
      bank.heights[i] -= give
      bank.heights[i + 1] += give
      moved = true
    }
  } else {
    for (var j = 1; j < bank.segments; j++) {
      var takeLeft = Math.min(bank.heights[j], move)
      if (takeLeft <= 0) continue
      var roomLeft = bank.limit[j - 1] - bank.heights[j - 1]
      var giveLeft = Math.min(takeLeft, roomLeft)
      if (giveLeft <= 0) continue
      bank.heights[j] -= giveLeft
      bank.heights[j - 1] += giveLeft
      moved = true
    }
  }
  if (shedAtEdge === true) {
    var edge = direction >= 0 ? bank.segments - 1 : 0
    var lost = Math.min(bank.heights[edge], move)
    if (lost > 0) {
      bank.heights[edge] -= lost
      moved = true
    }
  }
  if (moved) bank.revision++
  return moved
}

// Gently flatten peaks into their two neighbours. Mass is conserved: snow
// removed from a peak is added to adjacent segments, never discarded.
function redistribute(bank, amount) {
  var rate = Math.max(0, amount)
  if (rate === 0 || bank.segments < 3) return false
  var moved = false
  for (var i = 1; i < bank.segments - 1; i++) {
    var average = (bank.heights[i - 1] + bank.heights[i + 1]) / 2
    var excess = bank.heights[i] - average
    if (excess <= rate) continue
    var give = Math.min(rate, excess / 2)
    if (give < 0.01) continue
    var leftRoom = bank.limit[i - 1] - bank.heights[i - 1]
    var rightRoom = bank.limit[i + 1] - bank.heights[i + 1]
    var actual = Math.min(give, leftRoom, rightRoom)
    if (actual <= 0) continue
    bank.heights[i] -= actual * 2
    bank.heights[i - 1] += actual
    bank.heights[i + 1] += actual
    moved = true
  }
  if (moved) bank.revision++
  return moved
}

function erode(bank, amount) {
  var rate = Math.max(0, amount)
  if (rate === 0) return false
  var moved = false
  for (var i = 0; i < bank.segments; i++) {
    if (bank.heights[i] === 0) continue
    var next = Math.max(0, bank.heights[i] - rate)
    if (next !== bank.heights[i]) {
      bank.heights[i] = next
      moved = true
    }
  }
  if (moved) bank.revision++
  return moved
}

function totalDepth(bank) {
  var total = 0
  for (var i = 0; i < bank.segments; i++) total += bank.heights[i]
  return total
}

// Resize a bank by resampling its profile. Mass is approximately preserved,
// which lets a resized window keep its snow instead of blinking empty.
function resize(bank, width) {
  var newWidth = Math.max(1, width)
  var newSegments = Math.max(1, Math.ceil(newWidth / bank.segmentWidth))
  if (newSegments === bank.segments) {
    bank.width = newWidth
    return false
  }
  // Scale by the segment-count ratio so total snow mass is conserved when a
  // window grows or shrinks, rather than changing with its width.
  var massScale = bank.segments / newSegments
  var next = new Float32Array(newSegments)
  var nextLimit = new Float32Array(newSegments)
  nextLimit.fill(bank.maxDepth)
  for (var i = 0; i < newSegments; i++) {
    var source = (i + 0.5) * bank.segments / newSegments - 0.5
    var low = Math.floor(source)
    var high = Math.min(bank.segments - 1, low + 1)
    var t = source - low
    var sampled = low < 0 ? bank.heights[0]
      : bank.heights[low] * (1 - t) + bank.heights[high] * t
    next[i] = sampled * massScale
  }
  bank.heights = next
  bank.limit = nextLimit
  bank.segments = newSegments
  bank.width = newWidth
  bank.revision++
  return true
}

// Whether snow can rest on this segment. Covered, off-screen and headroom-less
// segments have a limit below MIN_LANDABLE and are invisible to flakes.
var MIN_LANDABLE = 1.5

function landable(bank, x) {
  return bank.limit[indexAt(bank, x)] >= MIN_LANDABLE
}

// Install per-segment limits (length must equal bank.segments). Snow that no
// longer fits under its new ceiling is clamped away: a window that gets covered
// or squeezed must not keep snow floating over other content.
function applyLimits(bank, limits) {
  var changed = false
  for (var i = 0; i < bank.segments; i++) {
    var raw = limits && i < limits.length ? limits[i] : bank.maxDepth
    var cap = raw >= MIN_LANDABLE ? Math.min(bank.maxDepth, raw) : 0
    bank.limit[i] = cap
    if (bank.heights[i] > cap) {
      bank.heights[i] = cap
      changed = true
    }
  }
  if (changed) bank.revision++
  return changed
}

// Remove snow under a circular brush and report the *area* removed in square
// logical pixels (height units x segment width). Used by the snowman roller:
// a column is touched when the brush circle intersects the snow it holds, so a
// pointer sweeping along a pile gathers exactly what it passes over.
//   amount  - height units a segment may lose at the brush centre
//   maxArea - stop once this much has been gathered (0 = unlimited)
function scoop(bank, cx, cy, radius, amount, maxArea) {
  if (!(radius > 0) || !(amount > 0)) return 0
  var first = Math.max(0, Math.floor((cx - radius - bank.x) / bank.segmentWidth))
  var last = Math.min(bank.segments - 1, Math.floor((cx + radius - bank.x) / bank.segmentWidth))
  var removed = 0
  var radiusSq = radius * radius
  for (var i = first; i <= last; i++) {
    var h = bank.heights[i]
    if (h <= 0) continue
    var px = bank.x + (i + 0.5) * bank.segmentWidth
    var dx = px - cx
    var top = bank.y - h
    var dy = cy < top ? top - cy : (cy > bank.y ? cy - bank.y : 0)
    var distSq = dx * dx + dy * dy
    if (distSq > radiusSq) continue
    var falloff = 1 - Math.sqrt(distSq) / radius
    var take = Math.min(h, amount * (0.35 + 0.65 * falloff))
    if (maxArea > 0) take = Math.min(take, Math.max(0, (maxArea - removed) / bank.segmentWidth))
    if (take <= 0) break
    bank.heights[i] = h - take
    removed += take * bank.segmentWidth
  }
  if (removed > 0) bank.revision++
  return removed
}

// Add snow to segments outward from `index`, filling whatever headroom exists.
// Shared by compact() so a ball pressing into a bank cannot delete snow.
function addOutward(bank, index, step, amount) {
  var added = 0
  for (var i = index; i >= 0 && i < bank.segments; i += step) {
    if (amount - added <= 0) break
    var room = bank.limit[i] - bank.heights[i]
    if (room <= 0) continue
    var give = Math.min(room, amount - added)
    bank.heights[i] += give
    added += give
  }
  return added
}

// Press a snowball into the bank: lower the segments under its footprint and
// push that snow into the neighbouring segments just outside it. Mass is
// conserved, the impression is visible, and the returned area is the amount
// actually displaced (0 when the bank was full and there was nowhere to push).
function compact(bank, cx, radius, amount) {
  if (!bank || !(radius > 0) || !(amount > 0)) return 0
  var first = Math.max(0, Math.floor((cx - radius - bank.x) / bank.segmentWidth))
  var last = Math.min(bank.segments - 1, Math.floor((cx + radius - bank.x) / bank.segmentWidth))
  var taken = 0
  var i
  for (i = first; i <= last; i++) {
    var h = bank.heights[i]
    if (h <= 0) continue
    var px = bank.x + (i + 0.5) * bank.segmentWidth
    var falloff = 1 - Math.min(1, Math.abs(px - cx) / radius)
    var t = Math.min(h, amount * (0.3 + 0.7 * falloff))
    if (t <= 0) continue
    bank.heights[i] = h - t
    taken += t
  }
  if (taken <= 0) return 0

  var half = taken / 2
  var outside = addOutward(bank, first - 1, -1, half)
    + addOutward(bank, last + 1, 1, half)
  // If the neighbours were at their ceiling, put the unplaced part back into
  // the footprint. Compression must never remove snow from the desktop.
  var leftover = taken - outside
  if (leftover > 0) {
    for (i = first; i <= last && leftover > 0; i++) {
      var room = bank.limit[i] - bank.heights[i]
      if (room <= 0) continue
      var give = Math.min(room, leftover)
      bank.heights[i] += give
      leftover -= give
    }
  }
  if (outside > 0) bank.revision++
  return outside * bank.segmentWidth
}

// Lift a bounded amount from one segment and report the exact *area* removed
// (height units x segment width). Window shedding uses this so the snow it
// takes from a bank can be carried by a falling particle without being created
// or lost on the way down. The companion operation is giveBack(), which puts
// that same area onto whichever surface the particle lands on.
function takeFromSegment(bank, index, amount) {
  if (!bank || index < 0 || index >= bank.segments || !(amount > 0)) return 0
  var take = Math.min(bank.heights[index], amount)
  if (take <= 0) return 0
  bank.heights[index] -= take
  bank.revision++
  return take * bank.segmentWidth
}

// Put gathered snow back (an abandoned or too-small snowball). `area` is in
// square pixels; it is spread over `reach` segments each side of x so the
// returned snow forms a soft mound instead of a spike. Capped by the limits.
// Last resort for returning snow: pour it into the nearest free capacity,
// working outward from x. giveBack() lays a soft mound and drops whatever lands
// on a segment that is already at its limit; this never drops snow while any
// segment still has room, so mass is lost only when the bank is truly full.
// Bounded by the segment count, allocation-free. Returns the area placed.
function fillNearest(bank, x, area) {
  if (!(area > 0)) return 0
  var units = area / bank.segmentWidth
  var left = units
  var centre = indexAt(bank, x)
  for (var d = 0; d < bank.segments && left > 1e-6; d++) {
    for (var side = 0; side < 2 && left > 1e-6; side++) {
      if (d === 0 && side === 1) break
      var i = side === 0 ? centre - d : centre + d
      if (i < 0 || i >= bank.segments) continue
      var room = bank.limit[i] - bank.heights[i]
      if (!(room > 0)) continue
      var take = room < left ? room : left
      bank.heights[i] += take
      left -= take
    }
  }
  var placed = (units - left) * bank.segmentWidth
  if (placed > 0) bank.revision++
  return placed
}

function giveBack(bank, x, area, reach) {
  if (!(area > 0)) return 0
  var spread = Math.max(1, Math.floor(reach || 8))
  var centre = indexAt(bank, x)
  // Renormalise the soft mound over the segments that actually exist. Without
  // this, returning snow near a bank edge silently dropped the weight of the
  // out-of-range segments, losing mass when a shed chunk landed at an edge.
  var offset, sum = 0
  for (offset = -spread; offset <= spread; offset++) {
    var i = centre + offset
    if (i < 0 || i >= bank.segments) continue
    sum += 1 - Math.abs(offset) / (spread + 1)
  }
  if (sum <= 0) return 0
  var units = area / bank.segmentWidth
  var before = totalDepth(bank)
  for (offset = -spread; offset <= spread; offset++) {
    var j = centre + offset
    if (j < 0 || j >= bank.segments) continue
    var value = units * (1 - Math.abs(offset) / (spread + 1)) / sum
    var next = Math.min(bank.limit[j], bank.heights[j] + value)
    if (next !== bank.heights[j]) bank.heights[j] = next
  }
  var added = (totalDepth(bank) - before) * bank.segmentWidth
  if (added > 0) bank.revision++
  return added
}

function clear(bank) {
  bank.heights.fill(0)
  bank.revision++
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fillNearest: fillNearest,
    create: create,
    indexAt: indexAt,
    heightAt: heightAt,
    surfaceTopAt: surfaceTopAt,
    deposit: deposit,
    slide: slide,
    redistribute: redistribute,
    erode: erode,
    totalDepth: totalDepth,
    resize: resize,
    clear: clear,
    landable: landable,
    applyLimits: applyLimits,
    scoop: scoop,
    compact: compact,
    takeFromSegment: takeFromSegment,
    giveBack: giveBack,
    MIN_LANDABLE: MIN_LANDABLE
  };
}
