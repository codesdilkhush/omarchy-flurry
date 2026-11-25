.pragma library

// Which sound goes with what the scene does, and how loud. Pure JavaScript,
// tested under node (tests/sound.test.js); Sound.qml plays what this picks.
//
// Every effect has its own bed: three takes (sounds/bed-<effect>-<n>.wav),
// each faded in and out over BED_OVERLAP, and the player starts the next,
// a different one, that long before the last one ends. No fixed loop to
// hear coming round.
// and the scene's events (lib/sim.js pushEvent) each have a few variants,
// never the same one twice running:
//   thunder   with the flash of every bolt, in the same frame: a close one
//             (it reaches far down the screen) cracks, a far one rolls
//   shed      a soft thud when a window, the plow or a snowball throws snow
//   ice       an icicle snapping off
//   meteor    a faint glint for a shooting star
//   launch / burst   New Year fireworks
//   golden    the golden snowflake caught
//   throw     a snowball flung off the screen

var EFFECTS = ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]

var SHOTS = {
  thunderNear: ["thunder-near-1", "thunder-near-2", "thunder-near-3"],
  thunderFar: ["thunder-far-1", "thunder-far-2", "thunder-far-3"],
  shed: ["snow-thud-1", "snow-thud-2", "snow-thud-3"],
  ice: ["ice-1", "ice-2", "ice-3"],
  chime: ["chime-1", "chime-2", "chime-3"],
  launch: ["firework-launch"],
  burst: ["firework-boom-1", "firework-boom-2", "firework-boom-3"],
  whoosh: ["whoosh-1", "whoosh-2"],
  bells: ["sleigh-bells"]
}

// The fewest seconds between two sounds of one kind (a shake throws snow
// off in many pieces; one thud a beat is enough).
var GAP = { thunderNear: 1.2, thunderFar: 1.2, shed: 0.14, ice: 0.12, chime: 0.6, launch: 0.15, burst: 0.12, whoosh: 0.2, bells: 3 }

// How loud each bed sits, at intensity 1 (the user's volume on top).
var BED = { snow: 0.7, leaves: 0.65, starfall: 0.55, rain: 0.6, sakura: 0.65, fireflies: 0.7 }

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }

function allShots() {
  var out = []
  for (var k in SHOTS) for (var i = 0; i < SHOTS[k].length; i++) out.push(SHOTS[k][i])
  return out
}
var BED_TAKES = 3
var BED_SECONDS = 14     // each take (tools/make-sounds.py)
var BED_OVERLAP = 2.5    // s: the next take starts this long before the end
function bedTakes(effect) {
  var out = []
  if (EFFECTS.indexOf(effect) < 0) return out
  for (var i = 1; i <= BED_TAKES; i++) out.push("bed-" + effect + "-" + i)
  return out
}
function bedFiles() {
  var out = []
  for (var i = 0; i < EFFECTS.length; i++) out = out.concat(bedTakes(EFFECTS[i]))
  return out
}
// The take to play next: any but the one playing now.
function nextTake(effect, current, rnd) {
  var list = bedTakes(effect)
  if (!list.length) return ""
  var at = list.indexOf(current)
  var r = rnd === undefined ? Math.random() : rnd
  if (at < 0) return list[Math.min(list.length - 1, Math.floor(r * list.length))]
  var i = Math.min(list.length - 2, Math.floor(r * (list.length - 1)))
  return list[i >= at ? i + 1 : i]
}

function newState() { return { last: {}, at: {} } }

// A variant of `kind`, not the one played last, unless it is the only one.
function pick(state, kind, rnd) {
  var list = SHOTS[kind]
  if (!list || !list.length) return ""
  if (list.length === 1) return list[0]
  var r = rnd === undefined ? Math.random() : rnd
  var i = Math.floor(r * (list.length - 1))
  var last = list.indexOf(state.last[kind])
  if (last >= 0 && i >= last) i++
  return list[clamp(i, 0, list.length - 1)]
}

// What to play for a scene event at time `now` (s): { name, volume } or null.
function cueFor(state, ev, now, rnd) {
  if (!ev || !ev.type) return null
  var kind = "", vol = 1
  switch (ev.type) {
  case "thunder":
    kind = ev.near ? "thunderNear" : "thunderFar"
    vol = ev.near ? 1 : 0.8
    break
  case "shed":
    if (!(ev.amount > 0.3)) return null
    kind = "shed"
    vol = clamp(0.25 + Math.sqrt(ev.amount) * 0.12, 0.25, 0.85)
    break
  case "ice":
    kind = "ice"
    vol = clamp(0.35 + (ev.len || 0) / 60, 0.35, 0.8)
    break
  case "meteor": kind = "chime"; vol = 0.22; break
  case "golden": kind = "chime"; vol = 0.7; break
  case "launch": kind = "launch"; vol = 0.45; break
  case "burst": kind = "burst"; vol = 0.85; break
  case "throw": kind = "whoosh"; vol = 0.6; break
  case "sleigh": kind = "bells"; vol = 0.5; break
  default: return null
  }
  var gap = GAP[kind] || 0
  // Thunder: one at a time, whichever kind.
  var gate = kind === "thunderNear" || kind === "thunderFar" ? "thunder" : kind
  if (state.at[gate] !== undefined && now - state.at[gate] < gap) return null
  var name = pick(state, kind, rnd)
  if (!name) return null
  state.at[gate] = now
  state.last[kind] = name
  return { name: name, volume: vol }
}

// The bed for an effect, "" for none (off, hidden, or behind a fullscreen
// app); and how loud, from the effect's intensity (0.25..2) and, for rain,
// how hard it is storming.
function bedFor(effect, live) { return live && EFFECTS.indexOf(effect) >= 0 ? effect : "" }
function bedLevel(effect, intensity, wet) {
  var base = BED[effect] || 0
  var k = 0.55 + 0.45 * clamp((intensity || 1) / 2, 0, 1)
  if (effect === "rain") k *= 0.8 + 0.4 * clamp(wet === undefined ? 0.5 : wet, 0, 1)
  return clamp(base * k * 1.4, 0, 1)
}
