// Snowball rolling: build a snowman by dragging across fallen snow.
//
// Pure JavaScript, no Qt. The pointer drags a growing snowball over piles of
// snow (on the ground or on window tops). Every stretch of travel scoops the
// snow under a circular brush; the brush grows with the ball, exactly like a
// real snowball picking up more the bigger it gets. Scrubbing in circles over a
// pile keeps gathering from the area around it, and the ball grows gradually.
//
// The model never touches the snow itself: the caller supplies
//   gather(cx, cy, brushRadius, amountPerSegment, maxArea) -> area removed
// so this file stays testable without a simulation.

var PI = Math.PI

// Loose snow packs down when rolled: this many square pixels of ball per square
// pixel of snow taken from a pile. 5.5 turns a 100 px wide, 9 px deep strip
// into a ball of about radius 24.
var COMPACTION = 5.5

var MIN_RADIUS = 12          // smaller than this is not a ball: snow is returned
var MAX_RADIUS = 58          // the ball stops growing here
var BRUSH_MIN = 16           // brush radius of a brand-new ball
var BRUSH_MAX = 60
var BRUSH_FRACTION = 0.9     // brush radius relative to the ball radius
var GATHER_PER_PX = 0.07     // height units taken at the brush centre per px of travel
var STEP_FRACTION = 0.5      // stamp the brush every half brush radius of travel
var VISIBLE_MIN_RADIUS = 5   // a ball with no snow yet still shows as a dot

// Pointer following. The ball is no longer glued to the cursor: the pointer is
// a target and the ball accelerates towards it, coasts, and settles when it
// arrives. A fast flick is capped so the brush still stamps the whole path.
var FOLLOW_TIME = 0.11       // seconds to close most of the gap to the pointer
var MAX_ROLL_SPEED = 900     // px/s ceiling for a fast flick
var SNAP_DISTANCE = 1.5      // settle exactly on the pointer when this close
var SETTLE_SPEED = 12        // px/s below which a close ball stops dead

// Loose snow packs down as it is rolled. Compaction is separate from the snow
// area (which still determines the physical radius used by the snowman model):
// a well-rolled ball looks a little smaller and denser than a fresh one.
var COMPACTION_RATE = 0.55   // compaction per second of active gathering
var IDLE_COMPACTION_RATE = 0.12
var VISUAL_COMPRESSION = 0.16 // up to 16% smaller radius when fully compacted

// Cosmetic contact effects. They are emitted as plain data so the simulation
// decides what to do with them (tracks in the bank, dust in the particle pool).
var TRACK_INTERVAL = 8       // px of travel between pressed tracks
var DUST_INTERVAL = 14       // px of travel between snow puffs
var DUST_SPEED = 70          // px/s for scattered/attracted flakes
var MAX_EFFECTS = 24         // bound per step

function create(x, y) {
  return {
    x: x, y: y,
    targetX: x, targetY: y,
    vx: 0, vy: 0,
    area: 0, travel: 0, spin: 0,
    lastGathered: 0, stalled: 0,
    compaction: 0,
    dustDistance: 0, trackDistance: 0
  }
}

// The pointer moves the *target*, never the ball itself. QML calls this on
// press/move only; Simulation.step() advances the ball once per fixed step.
function setTarget(roll, x, y) {
  if (!roll) return
  if (typeof x === "number" && isFinite(x)) roll.targetX = x
  if (typeof y === "number" && isFinite(y)) roll.targetY = y
}

// Deterministic 0..1 variation from travel distance: no RNG dependency, so the
// pure model stays reproducible without injecting Math.random.
function noise(roll, salt) {
  var v = Math.sin((roll.travel + salt * 17.31) * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

// Radius of the packed ball for a given amount of gathered snow area.
function radiusFor(area) {
  var a = area > 0 ? area : 0
  return Math.min(MAX_RADIUS, Math.sqrt(a * COMPACTION / PI))
}

// Snow area that makes a ball of this radius (inverse of radiusFor).
function areaFor(radius) {
  var r = radius > 0 ? radius : 0
  return PI * r * r / COMPACTION
}

function maxArea() {
  return areaFor(MAX_RADIUS)
}

function brushRadius(roll) {
  var wanted = radiusFor(roll.area) * BRUSH_FRACTION
  return Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, wanted))
}

// Radius to draw while rolling: never invisible, never above the cap. A
// compacted ball is drawn slightly smaller than its mass-only radius, which
// reads as denser snow without changing the snowman stacking model.
function visibleRadius(roll) {
  var packed = roll && typeof roll.compaction === "number" ? roll.compaction : 1
  var base = radiusFor(roll && roll.area)
  return Math.max(VISIBLE_MIN_RADIUS, base * (1 - VISUAL_COMPRESSION * (1 - packed)))
}

function isFull(roll) {
  return radiusFor(roll.area) >= MAX_RADIUS - 0.01
}

function ready(roll) {
  return radiusFor(roll.area) >= MIN_RADIUS
}

// Gather once at the ball's current position: pressing on a pile starts the
// ball even before the pointer moves.
function touch(roll, gather) {
  var room = maxArea() - roll.area
  if (room <= 0) return 0
  var brush = brushRadius(roll)
  var got = gather(roll.x, roll.y, brush, GATHER_PER_PX * brush * STEP_FRACTION, room)
  if (got > 0) roll.area += got
  roll.lastGathered = got
  return got
}

// Move the ball to (x, y), gathering along the straight path from its previous
// position. The path is stamped in steps no longer than half a brush so a fast
// flick cannot skip over snow. Returns the area gathered by this move.
function move(roll, x, y, gather) {
  var dx = x - roll.x
  var dy = y - roll.y
  var dist = Math.sqrt(dx * dx + dy * dy)
  if (!(dist > 0)) return 0

  var gathered = 0
  var brush = brushRadius(roll)
  var steps = Math.max(1, Math.ceil(dist / (brush * STEP_FRACTION)))
  var stepLength = dist / steps
  for (var k = 1; k <= steps; k++) {
    var room = maxArea() - roll.area
    if (room <= 0) break
    var t = k / steps
    var got = gather(roll.x + dx * t, roll.y + dy * t, brushRadius(roll),
      GATHER_PER_PX * stepLength, room)
    if (got > 0) {
      roll.area += got
      gathered += got
    }
  }

  roll.x = x
  roll.y = y
  roll.travel += dist
  // Rolling angle in radians: actual travel over the drawn radius, so the
  // texture turns with the distance covered rather than with pointer events.
  roll.spin += dist / Math.max(VISIBLE_MIN_RADIUS, visibleRadius(roll))
  roll.lastGathered = gathered
  // Count consecutive moves that found no snow, so the UI can hint where to go.
  roll.stalled = gathered > 0 ? 0 : roll.stalled + 1
  return gathered
}

// Finish a gesture by rolling the remaining straight leg to the pointer. The
// swept brush in move() stamps every sub-step, so this is not a teleport: any
// snow on the final leg is still collected, and the ball is released exactly
// where the user let go (which keeps stacking predictable).
function settle(roll, gather, effects) {
  if (!roll) return 0
  var fromX = roll.x
  var fromY = roll.y
  var gathered = move(roll, roll.targetX, roll.targetY, gather)
  roll.vx = 0
  roll.vy = 0
  var travelled = Math.sqrt((roll.x - fromX) * (roll.x - fromX)
    + (roll.y - fromY) * (roll.y - fromY))
  if (travelled > 0) emitEffects(roll, travelled, effects)
  return gathered
}

// Contact effects are data, not particles: the simulation owns the track store
// and the particle pool, so this module stays pure and QML-compatible.
function emitEffects(roll, travelled, effects) {
  if (!effects || effects.length >= MAX_EFFECTS) return
  roll.dustDistance += travelled
  roll.trackDistance += travelled
  var r = visibleRadius(roll)
  while (roll.trackDistance >= TRACK_INTERVAL && effects.length < MAX_EFFECTS) {
    roll.trackDistance -= TRACK_INTERVAL
    effects.push({ type: "track", x: roll.x, y: roll.y + r * 0.72,
      radius: Math.max(3, r * 0.55), strength: 0.55 })
  }
  while (roll.dustDistance >= DUST_INTERVAL && effects.length < MAX_EFFECTS) {
    roll.dustDistance -= DUST_INTERVAL
    if (noise(roll, 2) < 0.55) {
      // Scatter: small flakes pushed out of the contact area and up a little.
      var side = noise(roll, 1) < 0.5 ? -1 : 1
      effects.push({ type: "scatter",
        x: roll.x + side * r * 0.8, y: roll.y + r * 0.62,
        vx: roll.vx * 0.3 + side * DUST_SPEED * noise(roll, 3),
        vy: roll.vy * 0.2 - DUST_SPEED * noise(roll, 4),
        radius: 1 + noise(roll, 5) * 1.4 })
    } else {
      // Attraction: a flake just outside the brush moving into the ball.
      var angle = noise(roll, 6) * 6.2831853
      var distance = r + 8 + noise(roll, 7) * 12
      var px = roll.x + Math.cos(angle) * distance
      var py = roll.y + Math.sin(angle) * distance * 0.45 + r * 0.4
      effects.push({ type: "attract", x: px, y: py,
        vx: (roll.x - px) * 1.8,
        vy: (roll.y - py) * 1.8 - 6,
        radius: 0.9 + noise(roll, 8) * 1.2 })
    }
  }
}

// One fixed-step update of the rolling ball. The pointer is a target: velocity
// eases towards it (acceleration when far, deceleration when close), and the
// eased position is what gathers snow via the existing swept brush in move().
function advance(roll, dt, gather, effects) {
  if (!roll || !(dt > 0)) return 0
  var step = dt > 0.1 ? 0.1 : dt
  var dx = roll.targetX - roll.x
  var dy = roll.targetY - roll.y
  var dist = Math.sqrt(dx * dx + dy * dy)
  var wantedX = 0
  var wantedY = 0
  if (dist > SNAP_DISTANCE) {
    var speed = Math.min(MAX_ROLL_SPEED, dist / FOLLOW_TIME)
    wantedX = dx / dist * speed
    wantedY = dy / dist * speed
  }
  var blend = Math.min(1, step / FOLLOW_TIME)
  roll.vx += (wantedX - roll.vx) * blend
  roll.vy += (wantedY - roll.vy) * blend

  var fromX = roll.x
  var fromY = roll.y
  var gathered = move(roll, roll.x + roll.vx * step, roll.y + roll.vy * step, gather)

  // Come to rest on the pointer once the gap and speed are both tiny. This is
  // a sub-pixel correction, never a teleport across the pile.
  var speedNow = Math.sqrt(roll.vx * roll.vx + roll.vy * roll.vy)
  if (dist <= SNAP_DISTANCE && speedNow < SETTLE_SPEED) {
    roll.x = roll.targetX
    roll.y = roll.targetY
    roll.vx = 0
    roll.vy = 0
  }

  var travelled = Math.sqrt((roll.x - fromX) * (roll.x - fromX)
    + (roll.y - fromY) * (roll.y - fromY))
  var rate = gathered > 0 ? COMPACTION_RATE : IDLE_COMPACTION_RATE
  if (travelled > 0) roll.compaction = Math.min(1, roll.compaction + step * rate)
  if (travelled > 0) emitEffects(roll, travelled, effects)
  return gathered
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COMPACTION: COMPACTION,
    MIN_RADIUS: MIN_RADIUS,
    MAX_RADIUS: MAX_RADIUS,
    BRUSH_MIN: BRUSH_MIN,
    BRUSH_MAX: BRUSH_MAX,
    GATHER_PER_PX: GATHER_PER_PX,
    FOLLOW_TIME: FOLLOW_TIME,
    MAX_ROLL_SPEED: MAX_ROLL_SPEED,
    VISUAL_COMPRESSION: VISUAL_COMPRESSION,
    TRACK_INTERVAL: TRACK_INTERVAL,
    DUST_INTERVAL: DUST_INTERVAL,
    create: create,
    setTarget: setTarget,
    advance: advance,
    settle: settle,
    radiusFor: radiusFor,
    areaFor: areaFor,
    maxArea: maxArea,
    brushRadius: brushRadius,
    visibleRadius: visibleRadius,
    isFull: isFull,
    ready: ready,
    move: move,
    touch: touch
  };
}
