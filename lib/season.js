.pragma library

// Flurry's calendar: the time of year and the time of day, turned into the
// numbers the simulation runs on. Plain JavaScript with no QML types, so it
// is tested under node.
//
//   * Seasons. From November the snow falls as you set it. Two weeks before
//     Nowruz (the March equinox) it eases off and melts, sprouts come up
//     along the ground and blossom petals drift down instead of flakes.
//     Spring holds through Sizdah Bedar (the thirteenth day), then fades
//     back to whatever you picked. April to October, Flurry does what you
//     chose and nothing more.
//
//   * The day. Snow settles and, on mild afternoons, slowly melts; icicles
//     grow where meltwater refreezes; at night the snow takes on a faint
//     glaze. With live weather the real temperature drives all of it;
//     without, a mild winter day is assumed.
//
//   * New Year. Midnight on January 1st, local time: a quiet countdown, then
//     a minute or two of fireworks.

var DAY = 86400000
var SPRING_LEAD_DAYS = 14          // the thaw starts this long before Nowruz
var SPRING_HOLD_DAYS = 12          // full spring through the 13th day (Sizdah Bedar)
var SPRING_FADE_DAYS = 2
var NEW_YEAR = { countdown: 10, show: 100 }   // seconds before / after midnight
var TEHRAN_OFFSET_MIN = 210        // Iran Standard Time, UTC+3:30 (no DST since 2022)

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t) }

// ------------------------------------------------------------- the equinox
//
// The March equinox after Meeus, Astronomical Algorithms ch. 27: the mean
// instant from table 27.B, corrected by the 24 periodic terms of table 27.C.
// Good to about a minute for 1951-2050 and a few minutes beyond, which is
// what deciding the day of Nowruz needs.

var EQ_TERMS = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
  [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
  [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
  [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
  [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]
]

// The instant of the March equinox in `year`, as a Date (UTC).
function marchEquinox(year) {
  var Y = (year - 2000) / 1000
  var jde0 = 2451623.80984 + 365242.37404 * Y + 0.05169 * Y * Y - 0.00411 * Y * Y * Y - 0.00057 * Y * Y * Y * Y
  var T = (jde0 - 2451545.0) / 36525
  var rad = Math.PI / 180
  var W = (35999.373 * T - 2.47) * rad
  var dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W)
  var S = 0
  for (var i = 0; i < EQ_TERMS.length; i++) S += EQ_TERMS[i][0] * Math.cos((EQ_TERMS[i][1] + EQ_TERMS[i][2] * T) * rad)
  var jde = jde0 + 0.00001 * S / dl
  // Terrestrial to universal time: ΔT is a little over a minute these years.
  var dT = 62.92 + 0.32217 * (year - 2000) + 0.005589 * (year - 2000) * (year - 2000)
  var jd = jde - clamp(dT, 60, 120) / 86400
  return new Date((jd - 2440587.5) * DAY)
}

// Nowruz: the day, in Tehran, the year turns. If the equinox falls before
// noon there it is that day, otherwise the next. Returned as a calendar
// date { y, m (1-12), d }.
function nowruz(year) {
  var eq = marchEquinox(year)
  var local = new Date(eq.getTime() + TEHRAN_OFFSET_MIN * 60000)
  var y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate()
  if (local.getUTCHours() >= 12) {
    var next = new Date(Date.UTC(y, m, d + 1))
    y = next.getUTCFullYear(); m = next.getUTCMonth(); d = next.getUTCDate()
  }
  return { y: y, m: m + 1, d: d }
}

// Local midnight at the start of a calendar date, in the machine's zone.
function localMidnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0) }

// ------------------------------------------------------------- seasons
//
// season(date) -> { name, spring 0..1, christmas, winter }
//   name: "winter" (Nov to the thaw), "thaw" (the two weeks before Nowruz),
//         "spring" (Nowruz to Sizdah Bedar, then fading), or "off".
//   spring: how far into spring the scene is: 0 deep winter, 1 full spring.

function season(date) {
  var t = date.getTime()
  var year = date.getFullYear()
  var n = nowruz(year)
  var start = localMidnight(n.y, n.m, n.d).getTime()
  var thaw = start - SPRING_LEAD_DAYS * DAY
  var hold = start + (SPRING_HOLD_DAYS + 1) * DAY
  var gone = hold + SPRING_FADE_DAYS * DAY
  var month = date.getMonth() + 1, day = date.getDate()
  var christmas = (month === 12) || (month === 1 && day <= 6)
  if (t >= thaw && t < start) return { name: "thaw", spring: smooth((t - thaw) / (start - thaw)), christmas: false, winter: true }
  if (t >= start && t < hold) return { name: "spring", spring: 1, christmas: false, winter: false }
  if (t >= hold && t < gone) return { name: "spring", spring: 1 - smooth((t - hold) / (gone - hold)), christmas: false, winter: false }
  var winter = month >= 11 || t < thaw
  return { name: winter ? "winter" : "off", spring: 0, christmas: christmas, winter: winter }
}

// ------------------------------------------------------------- New Year
//
// newYear(date) -> { phase: "countdown" | "show" | "", seconds }
//   countdown: the last NEW_YEAR.countdown seconds of the year, seconds left.
//   show: the first NEW_YEAR.show seconds of January 1st, seconds since.

function newYear(date) {
  var t = date.getTime()
  var next = new Date(date.getFullYear() + 1, 0, 1, 0, 0, 0, 0).getTime()
  var last = new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0).getTime()
  var left = (next - t) / 1000
  if (left > 0 && left <= NEW_YEAR.countdown) return { phase: "countdown", seconds: left }
  var since = (t - last) / 1000
  if (since >= 0 && since < NEW_YEAR.show) return { phase: "show", seconds: since }
  return { phase: "", seconds: 0 }
}

// Milliseconds until the next moment newYear() changes phase, so the
// service can sleep until then instead of checking every second.
function msUntilNewYearWatch(date) {
  var next = new Date(date.getFullYear() + 1, 0, 1, 0, 0, 0, 0).getTime()
  var wake = next - (NEW_YEAR.countdown + 5) * 1000
  var t = date.getTime()
  if (newYear(date).phase !== "") return 1000
  return Math.max(1000, Math.min(wake - t, 3600000))
}

// ------------------------------------------------------------- the day
//
// sun(date): 0 at night .. 1 in the early afternoon, the warmth of the day.
function sun(date) {
  var h = date.getHours() + date.getMinutes() / 60
  var c = Math.cos(2 * Math.PI * (h - 13.5) / 24)
  return clamp((c - 0.2) / 0.8, 0, 1)
}

// dayCycle(date, tempC?) -> what the snow does at this hour.
//   tempC:  the air temperature used (the real one, or a mild winter day)
//   melt:   share of the lying snow lost per second (0 when it is freezing)
//   settle: extra settling (packing) per second, faster in the warmth
//   freeze: 0..1, how glazed the snow becomes (cold, clear nights)
//   icicle: 0..1, how fast icicles grow (meltwater that refreezes)
//   drip:   0..1, how often icicles drip (meltwater running)
function dayCycle(date, tempC) {
  var s = sun(date)
  var known = typeof tempC === "number" && isFinite(tempC)
  var T = known ? tempC : -4 + 5 * s
  var warm = Math.max(0, T)
  // Above freezing, snow loses about a third of its depth an hour per
  // degree in full sun, much less in the shade of the evening.
  var melt = warm > 0 ? warm * (0.35 + 0.65 * s) / 3600 / 3 : 0
  var settle = (0.4 + 0.6 * s) * (1 + warm * 0.5) / 1800
  var cold = clamp(-T / 4, 0, 1)
  var freeze = clamp(cold * (1 - s) * 1.15, 0, 1)
  // Icicles need cold air to freeze in: they form through any cold day or
  // night (the snow's own warmth and the window's feed the meltwater) and
  // fastest in the afternoon sun; above a few degrees they stop.
  var icicle = clamp(clamp((3 - T) / 4, 0, 1) * (0.55 + 0.45 * s), 0, 1)
  var drip = T > -1.5 ? clamp(s * (T + 1.5) / 3, 0, 1) : 0
  return { tempC: T, measured: known, sun: s, melt: melt, settle: settle, freeze: freeze, icicle: icicle, drip: drip }
}

// ------------------------------------------------------------- together
//
// environment(date, opts) -> env the simulation reads (Sim.setEnv).
//   opts.weather:   Weather.map() output, or null
//   opts.seasons:   follow the calendar (spring, the thaw)
//   opts.dayCycle:  melt, settle, glaze and icicles by the hour
//   opts.override:  "", "winter" or "spring" (a preview)
//   opts.springAt:  0..1 progress to use with override "spring"
//   opts.calm:      calm mode is on now
function neutral() {
  return { snowScale: 1, windBase: 0, windVar: 28, tempC: -3, sun: 0, melt: 0, settle: 0, freeze: 0,
           icicle: 0.55, drip: 0, spring: 0, petals: 0, sprouts: 0, season: "off", calm: false, weather: false }
}

function environment(date, opts) {
  opts = opts || {}
  var env = neutral()
  var w = opts.weather || null
  if (w) {
    env.snowScale = w.snowScale
    env.windBase = w.windBase
    env.windVar = w.windVar
    env.weather = true
  }
  if (opts.dayCycle !== false) {
    var d = dayCycle(date, w ? w.tempC : undefined)
    env.tempC = d.tempC; env.sun = d.sun; env.melt = d.melt; env.settle = d.settle
    env.freeze = d.freeze; env.icicle = d.icicle; env.drip = d.drip
  } else if (w) env.tempC = w.tempC
  var s = opts.override === "spring" ? { name: "spring", spring: clamp(opts.springAt === undefined ? 1 : opts.springAt, 0, 1) }
        : opts.override === "winter" ? { name: "winter", spring: 0 }
        : opts.seasons !== false ? season(date) : { name: "off", spring: 0 }
  env.season = s.name
  var p = s.spring
  if (p > 0) {
    // Snow eases off and melts; petals take over the sky; the ground greens.
    env.spring = p
    env.snowScale *= Math.max(0, 1 - p * 1.15)
    env.petals = smooth((p - 0.25) / 0.75)
    var springTemp = 2 + 10 * p
    env.tempC = Math.max(env.tempC, springTemp * (0.5 + 0.5 * env.sun))
    env.melt = Math.max(env.melt, p * p / 1200)
    env.freeze *= 1 - p
    env.icicle *= 1 - p
    env.drip = Math.max(env.drip, p * (1 - p) * 2)
    env.sprouts = smooth((p - 0.35) / 0.65)
  }
  if (opts.calm) {
    env.calm = true
    env.snowScale *= 0.5
    env.windVar *= 0.6
  }
  return env
}
