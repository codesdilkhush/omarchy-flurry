.pragma library

// When Flurry runs and how hard: fullscreen, battery and calm mode, and
// when the rare surprises (a robin, a hare, the golden snowflake) come. Pure
// JavaScript, tested under node; the service feeds it what it reads from
// Hyprland, UPower and /sys/class/power_supply.

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }

// ------------------------------------------------------------- power
//
// The service lists /sys/class/power_supply as one line per supply:
//   name|type|status|capacity|online
// This reads it: { known, onBattery, percent }. On AC when any mains
// supply is online; on battery when a battery discharges and no mains is
// online. Desktops (no battery) are never on battery.
function parsePowerSupply(text) {
  var lines = String(text || "").split("\n")
  var mains = null, battery = false, discharging = false, pct = []
  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].split("|")
    if (f.length < 5) continue
    var type = f[1].trim(), status = f[2].trim().toLowerCase(), cap = Number(f[3]), online = f[4].trim()
    if (type === "Mains" || type === "USB" || type === "USB_C" || type === "USB_PD") {
      if (online === "1") mains = true
      else if (mains === null) mains = false
    } else if (type === "Battery") {
      // Peripherals (mice, headsets) report a scope; only the system battery counts.
      if (/hid|hidpp|wacom|ps-controller|sony|nintendo|logitech/i.test(f[0])) continue
      battery = true
      if (status === "discharging") discharging = true
      if (isFinite(cap) && f[3].trim() !== "") pct.push(clamp(cap, 0, 100))
    }
  }
  var percent = pct.length ? pct.reduce(function(a, b) { return a + b }, 0) / pct.length : 100
  return { known: battery || mains !== null, battery: battery, onBattery: battery && mains !== true && discharging, percent: percent }
}

// Hyprland's fullscreen state per window: 0 none, 1 maximized, 2
// fullscreen, 3 both. Only real fullscreen pauses the scene.
function fullscreenActive(modes) {
  for (var i = 0; i < (modes || []).length; i++) if (Number(modes[i]) >= 2) return true
  return false
}

// ------------------------------------------------------------- calm
//
// calm: "off", "on", or "work" (only within working hours).
// hours: { start: "09:00", end: "17:00", days: [0..6] (0 Sunday) }; an end
// before the start runs past midnight.
function minutesOf(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""))
  if (!m) return -1
  var h = +m[1], mm = +m[2]
  return h < 24 && mm < 60 ? h * 60 + mm : -1
}

function inHours(date, hours) {
  hours = hours || {}
  var a = minutesOf(hours.start), b = minutesOf(hours.end)
  if (a < 0 || b < 0 || a === b) return false
  var days = hours.days instanceof Array && hours.days.length ? hours.days : [0, 1, 2, 3, 4, 5, 6]
  var now = date.getHours() * 60 + date.getMinutes()
  if (a < b) return days.indexOf(date.getDay()) >= 0 && now >= a && now < b
  // Overnight: the evening part belongs to today, the morning to yesterday.
  if (now >= a) return days.indexOf(date.getDay()) >= 0
  return now < b && days.indexOf((date.getDay() + 6) % 7) >= 0
}

function calmNow(calm, hours, date) {
  if (calm === "on") return true
  if (calm === "work") return inHours(date, hours)
  return false
}

// ------------------------------------------------------------- the gate
//
// gate(s) -> { paused, quality, fps, calm, surprises, fireworks }
//   s.fullscreen   a real fullscreen window on this screen's workspace
//   s.onBattery, s.percent, s.batterySaver
//   s.calm         calm mode is on now (calmNow)
//   s.surprises, s.fireworks   the user's toggles
function gate(s) {
  s = s || {}
  var paused = !!s.fullscreen
  var quality = 1, fps = 60
  if (s.batterySaver !== false && s.onBattery) {
    quality = s.percent !== undefined && s.percent <= 20 ? 0.35 : 0.5
    fps = s.percent !== undefined && s.percent <= 20 ? 24 : 30
  }
  if (s.calm) quality = Math.min(quality, 0.75)
  return {
    paused: paused, quality: quality, fps: fps, calm: !!s.calm,
    surprises: !paused && !s.calm && s.surprises !== false && quality >= 0.5,
    fireworks: !paused && !s.calm && s.fireworks !== false
  }
}

// ------------------------------------------------------------- surprises
//
// Something small, now and then: a robin, a winter hare, and (rarely) the
// golden snowflake. Each comes only when it makes sense, and the reason
// it can't is kept for `flurry diag`.
//
// The scene's mode is what the sky is doing: with the Snow effect, the
// live weather's kind when Live weather is on ("snow", "flurries",
// "blizzard", "sleet", "rain", "clear"), else "snow"; "spring" once the
// thaw is well along; any other effect is its own mode ("leaves", "rain",
// "starfall", "sakura", "fireflies").
//
//   robin   snow, flurries, a clear cold day, or spring; not in a blizzard,
//           rain or sleet, nor in strong wind. Needs somewhere to land.
//   hare    snow, flurries or a clear day, with snow lying on the ground
//           (white coat); in spring on the sprouts (brown coat). Not in a
//           blizzard, rain or sleet; never while the plow is out.
//   golden  while it snows (snow, flurries, blizzard).
// None of them while calm mode is on, a window is being dragged, a
// fullscreen app is up, Flurry is being decorated, or surprises are off.
//
// ctx (from the shell): { mode, surprises, calm, fullscreen, dragging,
//   decorating, perches, groundSnow (mean px), groundCover (0..1 share
//   with >= 1.5 px), sprouts, windStrong, plow, snowing }

var SURPRISE = {
  first: [60000, 110000],     // the first one comes this soon after the scene starts
  minGap: 2.5 * 60000,        // at least this long between visits
  spread: 2.5 * 60000,        // plus up to this much more
  retry: 15000,               // nothing could come: look again this soon
  goldenGap: 50 * 60000,      // the golden snowflake is rarer still
  golden: 0.05,               // chance of the golden flake on a visit it may come
  weights: { bird: 0.55, rabbit: 0.45 }
}
var SNOWY_MODES = ["snow", "flurries"]
var KINDS = ["bird", "rabbit", "golden"]

function sceneMode(effect, env, weatherKind) {
  if (effect && effect !== "snow") return String(effect)
  if (env && env.spring >= 0.5) return "spring"
  return weatherKind ? String(weatherKind) : "snow"
}

// Why `kind` can't come now, or "" when it can.
function surpriseBlock(kind, ctx) {
  ctx = ctx || {}
  if (ctx.surprises === false) return "surprises are off"
  if (ctx.calm) return "calm mode"
  if (ctx.fullscreen) return "a fullscreen app is up"
  if (ctx.lowPower) return "battery is low"
  if (ctx.decorating) return "decorating"
  if (ctx.dragging) return "a window is moving"
  var mode = ctx.mode || "snow"
  if (kind === "bird") {
    if (mode === "blizzard") return "no robins in a blizzard"
    if (SNOWY_MODES.indexOf(mode) < 0 && mode !== "clear" && mode !== "spring") return "no robins in " + mode
    if (ctx.windStrong) return "too windy for a robin"
    if (!(ctx.perches > 0)) return "nowhere for a bird to land"
    return ""
  }
  if (kind === "rabbit") {
    if (ctx.plow) return "the plow is out"
    if (mode === "spring") return (ctx.sprouts || 0) >= 5 ? "" : "no sprouts up yet"
    // A clear, cold day with snow lying is hare weather too: with live
    // weather on, the sky is "clear" most of the time, and the hare used
    // never to come at all.
    if (SNOWY_MODES.indexOf(mode) < 0 && mode !== "clear") return "the hare comes only in snow (now " + mode + ")"
    if (!((ctx.groundCover || 0) >= 0.15 || (ctx.groundSnow || 0) >= 1)) return "no snow on the ground yet"
    return ""
  }
  if (kind === "golden") {
    if (SNOWY_MODES.indexOf(mode) < 0 && mode !== "blizzard") return "the golden flake falls only in snow"
    return ""
  }
  return "unknown: " + kind
}

// { bird: "", rabbit: "no snow on the ground yet", golden: "" }: "" for
// those that can come.
function surpriseOptions(history, now, ctx) {
  var out = {}
  for (var i = 0; i < KINDS.length; i++) out[KINDS[i]] = surpriseBlock(KINDS[i], ctx)
  var h = history || []
  for (var j = h.length - 1; j >= 0; j--) {
    if (h[j].kind !== "golden") continue
    if (now - h[j].at < SURPRISE.goldenGap && !out.golden) out.golden = "a golden flake came lately"
    break
  }
  return out
}

function surpriseWeights(history, now, ctx) {
  var opt = surpriseOptions(history, now, ctx)
  var w = { bird: opt.bird ? 0 : SURPRISE.weights.bird, rabbit: opt.rabbit ? 0 : SURPRISE.weights.rabbit,
            golden: opt.golden ? 0 : SURPRISE.golden }
  // Never the same visitor twice running while another could come.
  var h = history || []
  var last = h.length ? h[h.length - 1].kind : ""
  if ((last === "bird" || last === "rabbit") && w.bird > 0 && w.rabbit > 0) w[last] = 0
  return w
}

// The golden snowflake is a flat chance whenever it is allowed; otherwise
// a robin or the hare. "" when nothing can come now.
function pickSurprise(history, now, ctx, rng) {
  rng = rng || Math.random
  var w = surpriseWeights(history, now, ctx)
  if (w.golden > 0 && rng() < w.golden) return "golden"
  var total = w.bird + w.rabbit
  if (total <= 0) return ""
  return rng() * total < w.bird ? "bird" : "rabbit"
}

// opts.first: the scene has just started (the first visit comes within a
// couple of minutes); opts.missed: nothing could come, or it found no room
// (look again soon rather than in minutes).
function planSurprise(history, now, ctx, rng, opts) {
  rng = rng || Math.random
  opts = opts || {}
  var h = history || []
  var delay
  if (opts.missed) delay = SURPRISE.retry
  else if (opts.first || !h.length) delay = SURPRISE.first[0] + rng() * (SURPRISE.first[1] - SURPRISE.first[0])
  else delay = Math.max(SURPRISE.minGap + rng() * SURPRISE.spread, SURPRISE.minGap - (now - h[h.length - 1].at))
  return { kind: pickSurprise(h, now, ctx, rng), delay: Math.round(delay) }
}

function remember(history, kind, now) {
  return (history || []).concat([{ kind: kind, at: now }]).slice(-8)
}

// "cat" was the hare's name before it came; "" stays "" (pick one).
function surpriseAlias(kind) {
  kind = String(kind || "").toLowerCase().trim()
  if (kind === "cat" || kind === "hare" || kind === "bunny") return "rabbit"
  if (kind === "robin") return "bird"
  return kind
}

// ------------------------------------------------------------- diag
//
// What `flurry diag` prints: every feature's state and why it is (or
// isn't) active, put together from what the service and the scene know.
// o: { now, mode, weather: { live, kind }, env, gates, timer: { running,
//      nextAt }, history, last, ctx (scene: critterContext plus gates),
//      faults: { name: { message, count } } }
function diagReport(o) {
  o = o || {}
  var ctx = o.ctx || {}
  var env = o.env || {}
  var now = o.now || 0
  var opt = surpriseOptions(o.history, now, ctx)
  var ledges = ctx.ledges || []
  var ice = 0
  for (var i = 0; i < ledges.length; i++) ice += ledges[i].icicles || 0
  var num = function(v, d) { v = Number(v); return isFinite(v) ? +v.toFixed(d === undefined ? 2 : d) : null }
  var icicles = !(o.gates && o.gates.dayCycle === false) ? (o.mode === "snow" || o.mode === "flurries" || o.mode === "blizzard" || o.mode === "clear"
    ? (env.icicle > 0 ? "growing at " + num(env.icicle) + " of full rate" : "too warm to grow") : "only with the Snow effect")
    : "off (Melting, icicles, night glaze)"
  return {
    mode: o.mode || "",
    weather: { live: !!(o.weather && o.weather.live), kind: o.weather && o.weather.kind ? o.weather.kind : "(off: calendar)",
               tempC: num(env.tempC, 1), measured: !!env.weather, season: env.season || "", sun: num(env.sun), freeze: num(env.freeze) },
    gates: o.gates || {},
    surprises: {
      timer: o.timer && o.timer.running ? "running" : "stopped",
      nextInS: o.timer && o.timer.running ? Math.max(0, Math.round(((o.timer.nextAt || now) - now) / 1000)) : null,
      last: o.last || null,
      recent: (o.history || []).map(function(h) { return h.kind }),
      bird: opt.bird || "can come", rabbit: opt.rabbit || "can come", golden: opt.golden || "can come"
    },
    scene: ctx.offline ? { offline: ctx.offline } : {
      perches: ctx.perches, groundSnow: ctx.groundSnow, groundCover: ctx.groundCover, sprouts: ctx.sprouts,
      bird: ctx.bird || "-", rabbit: ctx.rabbit || "-", plowOut: !!ctx.plow, windStrong: !!ctx.windStrong
    },
    ice: { icicles: ice, status: icicles, ledges: ledges },
    faults: o.faults || {}
  }
}
