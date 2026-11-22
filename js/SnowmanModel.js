// Snowman construction model.
//
// Pure JavaScript data operations: no Qt, no rendering, no Hyprland. A snowman
// is a monitor-local anchor plus explicit ball and decoration records. Balls
// carry absolute monitor-local positions so dragging needs no coordinate
// algebra; decorations are attached by ball index with relative offsets.

var DEFAULT_RADII = [42, 31, 23];
var MIN_RADIUS = 12;
var MAX_RADIUS = 70;
var SNAP_DISTANCE = 52;
var STACK_FACTOR = 0.82;

function create(id, monitor, x, y, createdAt) {
  return {
    id: String(id || ""),
    monitor: String(monitor || ""),
    x: x,
    y: y,
    scale: 1,
    rotation: 0,
    createdAt: createdAt || 0,
    balls: [],
    decorations: []
  };
}

function clampRadius(radius) {
  var r = typeof radius === "number" && isFinite(radius) ? radius : DEFAULT_RADII[0];
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r));
}

function addBall(snowman, x, y, radius) {
  if (!snowman || snowman.balls.length >= 6) return -1;
  snowman.balls.push({ x: x, y: y, r: clampRadius(radius) });
  return snowman.balls.length - 1;
}

function distance(x1, y1, x2, y2) {
  var dx = x1 - x2;
  var dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Find the ball whose centre is closest to a point, within a tolerance that
// scales with the ball itself so large balls stay easy to grab.
function nearestBall(snowman, x, y, tolerance) {
  if (!snowman) return -1;
  var best = -1;
  var bestDistance = Infinity;
  for (var i = 0; i < snowman.balls.length; i++) {
    var ball = snowman.balls[i];
    var limit = tolerance === undefined ? ball.r + SNAP_DISTANCE : tolerance;
    var d = distance(x, y, ball.x, ball.y);
    if (d <= limit && d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

function nearestSnowman(snowmen, monitor, x, y, tolerance) {
  var best = null;
  var bestDistance = Infinity;
  for (var i = 0; i < snowmen.length; i++) {
    var snowman = snowmen[i];
    if (snowman.monitor !== monitor) continue;
    var index = nearestBall(snowman, x, y, tolerance);
    if (index < 0) continue;
    var ball = snowman.balls[index];
    var d = distance(x, y, ball.x, ball.y) - ball.r;
    if (d < bestDistance) {
      bestDistance = d;
      best = snowman;
    }
  }
  return best;
}

// Radius for the next ball in a stack: bottom, middle, head.
function radiusForStack(count) {
  return DEFAULT_RADII[Math.min(count, DEFAULT_RADII.length - 1)];
}

// Place a ball on top of a target ball with a small, natural overlap.
function stackedPosition(target, radius) {
  return {
    x: target.x,
    y: target.y - (target.r + radius) * STACK_FACTOR
  };
}

// Add a ball to an existing snowman, snapping onto a target when requested.
function addStackedBall(snowman, targetIndex, x, y, radius) {
  if (!snowman || snowman.balls.length >= 6) return -1;
  var r = clampRadius(radius === undefined ? radiusForStack(snowman.balls.length) : radius);
  var position = targetIndex >= 0 && targetIndex < snowman.balls.length
    ? stackedPosition(snowman.balls[targetIndex], r)
    : { x: x, y: y };
  return addBall(snowman, position.x, position.y, r);
}

// ---- Dropping a rolled snowball ---------------------------------------------
// A ball released near an existing snowman joins its stack; otherwise it starts
// a new snowman. Both decisions live here so they can be tested without a UI.
var ATTACH_MARGIN = 26;      // extra reach beyond the two radii when snapping
var STACK_MAX_RATIO = 0.8;   // a ball on top is at most this much of the ball below

// Follow the stack upwards: if another ball already sits on `index`, the new
// ball belongs on top of that one instead of overlapping it.
function topOfStack(snowman, index) {
  var current = index;
  for (var guard = 0; guard < snowman.balls.length; guard++) {
    var base = snowman.balls[current];
    var above = -1;
    var aboveY = Infinity;
    for (var i = 0; i < snowman.balls.length; i++) {
      if (i === current) continue;
      var ball = snowman.balls[i];
      var onTop = Math.abs(ball.x - base.x) <= base.r * 0.8
        && ball.y < base.y - base.r * 0.35
        && distance(ball.x, ball.y, base.x, base.y) <= base.r + ball.r;
      if (onTop && ball.y < aboveY) {
        above = i;
        aboveY = ball.y;
      }
    }
    if (above < 0) break;
    current = above;
  }
  return current;
}

// The snowman ball a released snowball should stack on, or null. `radius` is
// the released ball's radius. Returns { snowman, index } with index already
// advanced to the top of that snowman's stack.
function stackTarget(snowmen, monitor, x, y, radius) {
  var bestSnowman = null;
  var bestIndex = -1;
  var bestGap = Infinity;
  for (var s = 0; s < snowmen.length; s++) {
    var snowman = snowmen[s];
    if (snowman.monitor !== monitor) continue;
    for (var i = 0; i < snowman.balls.length; i++) {
      var ball = snowman.balls[i];
      var gap = distance(x, y, ball.x, ball.y) - ball.r;
      if (gap <= radius + ATTACH_MARGIN && gap < bestGap) {
        bestGap = gap;
        bestSnowman = snowman;
        bestIndex = i;
      }
    }
  }
  if (!bestSnowman) return null;
  return { snowman: bestSnowman, index: topOfStack(bestSnowman, bestIndex) };
}

// Radius for a ball stacked on `target`: a head is never bigger than the body.
function stackRadius(target, radius) {
  return clampRadius(Math.min(radius, target.r * STACK_MAX_RATIO));
}

function moveBall(snowman, index, x, y) {
  if (!snowman || index < 0 || index >= snowman.balls.length) return false;
  snowman.balls[index].x = x;
  snowman.balls[index].y = y;
  return true;
}

function translateBall(snowman, index, dx, dy) {
  if (!snowman || index < 0 || index >= snowman.balls.length) return false;
  snowman.balls[index].x += dx;
  snowman.balls[index].y += dy;
  return true;
}

function moveSnowman(snowman, dx, dy) {
  if (!snowman) return false;
  for (var i = 0; i < snowman.balls.length; i++) {
    snowman.balls[i].x += dx;
    snowman.balls[i].y += dy;
  }
  // Decorations are attached by ball index, so they move with their ball.
  snowman.x += dx;
  snowman.y += dy;
  return true;
}

// Removing a ball also removes decorations attached to it. Higher indices are
// shifted down so every decoration still points at a valid ball.
function removeBall(snowman, index) {
  if (!snowman || index < 0 || index >= snowman.balls.length) return false;
  snowman.balls.splice(index, 1);
  var kept = [];
  for (var i = 0; i < snowman.decorations.length; i++) {
    var decoration = snowman.decorations[i];
    if (decoration.ballIndex === index) continue;
    if (decoration.ballIndex > index) decoration.ballIndex--;
    kept.push(decoration);
  }
  snowman.decorations = kept;
  return true;
}

function addDecoration(snowman, type, ballIndex, dx, dy) {
  if (!snowman || ballIndex < 0 || ballIndex >= snowman.balls.length) return -1;
  if (snowman.decorations.length >= 24) return -1;
  snowman.decorations.push({
    type: String(type || "carrot"),
    ballIndex: ballIndex,
    dx: dx || 0,
    dy: dy || 0,
    rotation: 0,
    scale: 1
  });
  return snowman.decorations.length - 1;
}

function removeDecoration(snowman, index) {
  if (!snowman || index < 0 || index >= snowman.decorations.length) return false;
  snowman.decorations.splice(index, 1);
  return true;
}

function deleteSnowman(snowmen, id) {
  for (var i = 0; i < snowmen.length; i++) {
    if (snowmen[i].id === id) {
      snowmen.splice(i, 1);
      return true;
    }
  }
  return false;
}

function findSnowman(snowmen, id) {
  for (var i = 0; i < snowmen.length; i++)
    if (snowmen[i].id === id) return snowmen[i];
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_RADII: DEFAULT_RADII,
    MIN_RADIUS: MIN_RADIUS,
    MAX_RADIUS: MAX_RADIUS,
    SNAP_DISTANCE: SNAP_DISTANCE,
    STACK_FACTOR: STACK_FACTOR,
    create: create,
    clampRadius: clampRadius,
    addBall: addBall,
    nearestBall: nearestBall,
    nearestSnowman: nearestSnowman,
    radiusForStack: radiusForStack,
    stackedPosition: stackedPosition,
    addStackedBall: addStackedBall,
    moveBall: moveBall,
    translateBall: translateBall,
    topOfStack: topOfStack,
    stackTarget: stackTarget,
    stackRadius: stackRadius,
    ATTACH_MARGIN: ATTACH_MARGIN,
    STACK_MAX_RATIO: STACK_MAX_RATIO,
    moveSnowman: moveSnowman,
    removeBall: removeBall,
    addDecoration: addDecoration,
    removeDecoration: removeDecoration,
    deleteSnowman: deleteSnowman,
    findSnowman: findSnowman,
    distance: distance
  };
}
