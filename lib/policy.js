.pragma library

// When Flurry runs and how hard: fullscreen, battery and calm mode, and
// when the rare surprises (a bird, a cat, the golden snowflake) come. Pure
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
  return { known: battery || mains !== null, onBattery: battery && mains !== true && discharging, percent: percent }
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
// Something small and rare, now and then, never the same thing twice in a
// row if it can help it. history: [{ kind, at }] newest last. ctx says
// what the scene can host now: { snowyWindow, groundSnow, snowing }.
// rng: () -> [0, 1). Returns { kind, delay } (delay in ms until it comes),
// or { kind: "", delay } when nothing can come now (try again after delay).

var SURPRISE = {
  minGap: 6 * 60000,          // at least this long between surprises
  spread: 10 * 60000,         // plus up to this much more
  goldenGap: 50 * 60000,      // the golden snowflake is rarer still
  weights: { bird: 0.52, cat: 0.48, golden: 0.04 }
}

function surpriseWeights(history, now, ctx) {
  ctx = ctx || {}
  var w = { bird: ctx.snowyWindow ? SURPRISE.weights.bird : 0,
            cat: ctx.groundSnow ? SURPRISE.weights.cat : 0,
            golden: ctx.snowing ? SURPRISE.weights.golden : 0 }
  var h = history || []
  var last = h.length ? h[h.length - 1].kind : ""
  if (last && w[last] !== undefined) w[last] *= 0.15
  // Anything seen in the last three gets rarer too.
  for (var i = Math.max(0, h.length - 3); i < h.length; i++) if (w[h[i].kind] !== undefined) w[h[i].kind] *= 0.6
  for (var j = h.length - 1; j >= 0; j--) {
    if (h[j].kind !== "golden") continue
    if (now - h[j].at < SURPRISE.goldenGap) w.golden = 0
    break
  }
  return w
}

// The golden snowflake is a flat chance whenever it is allowed (so how
// often the others repeat never makes it commoner); otherwise a bird or a
// cat, weighted against whatever came lately.
function pickSurprise(history, now, ctx, rng) {
  rng = rng || Math.random
  var w = surpriseWeights(history, now, ctx)
  if (w.golden > 0 && rng() < w.golden) return "golden"
  var total = w.bird + w.cat
  if (total <= 0) return ""
  return rng() * total < w.bird ? "bird" : "cat"
}

function planSurprise(history, now, ctx, rng) {
  rng = rng || Math.random
  var delay = SURPRISE.minGap + rng() * SURPRISE.spread
  var h = history || []
  if (h.length) delay = Math.max(delay, SURPRISE.minGap - (now - h[h.length - 1].at))
  return { kind: pickSurprise(h, now, ctx, rng), delay: Math.round(delay) }
}

function remember(history, kind, now) {
  return (history || []).concat([{ kind: kind, at: now }]).slice(-8)
}
