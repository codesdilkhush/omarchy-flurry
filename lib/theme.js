.pragma library

// The Omarchy theme's colours, for tinting what Flurry paints. Omarchy
// keeps the current theme's palette in
// ~/.local/state/omarchy/current/theme/colors.toml (accent, background,
// foreground, the eight named colours, ...). Older themes only have
// color0..color15, so those are read too. Parsing and the derived palette
// are pure, so they are tested under node.

var FALLBACK = {
  mode: "dark",
  accent: "#7aa2f7", background: "#1a1b26", foreground: "#c0caf5",
  red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7",
  magenta: "#bb9af7", cyan: "#7dcfff", orange: "#ff9e64"
}

var ANSI = { color0: "background", color1: "red", color2: "green", color3: "yellow", color4: "blue",
             color5: "magenta", color6: "cyan", color7: "foreground" }

function hex(v) {
  var s = String(v || "").trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase()
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 7).toLowerCase()
  if (/^0x[0-9a-fA-F]{6}$/.test(s)) return ("#" + s.slice(2)).toLowerCase()
  return ""
}

// colors.toml -> the palette, every key filled (from the fallback where the
// theme has nothing). Unknown keys and lines that aren't `key = "value"`
// are ignored.
function parse(text) {
  var raw = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+|\s+$/g, "")
    if (!line || line[0] === "#" || line[0] === "[") continue
    var m = /^([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/.exec(line)
    if (m) raw[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4])
  }
  var out = { mode: raw.mode === "light" ? "light" : "dark", source: "theme" }
  var any = false
  for (var k in FALLBACK) {
    if (k === "mode") continue
    var v = hex(raw[k])
    if (!v) for (var a in ANSI) if (ANSI[a] === k && hex(raw[a])) v = hex(raw[a])
    if (v) any = true
    out[k] = v || FALLBACK[k]
  }
  if (!hex(raw.accent) && hex(raw.blue || raw.color4)) out.accent = out.blue
  if (!any) return fallback()
  return out
}

function fallback() {
  var f = {}
  for (var k in FALLBACK) f[k] = FALLBACK[k]
  f.source = "fallback"
  return f
}

function rgb(h) { h = hex(h) || "#000000"; return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)] }
function toHex(c) {
  var s = "#"
  for (var i = 0; i < 3; i++) { var v = Math.max(0, Math.min(255, Math.round(c[i]))); s += (v < 16 ? "0" : "") + v.toString(16) }
  return s
}
function mixHex(a, b, t) {
  var x = rgb(a), y = rgb(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
function luma(h) { var c = rgb(h); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 }
function saturation(h) {
  var c = rgb(h), mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2])
  return mx === 0 ? 0 : (mx - mn) / mx
}

// What Flurry paints with, from a palette:
//   lights:  bulbs for the "theme" light string, bright enough to glow
//   scarf:   the snowman's scarf
//   accent:  the theme's accent, for small touches (the golden flake's halo)
//   shadow:  the cool tone in the snow's shade, nudged toward the theme
//   rim:     the outline of the snow caps
//   ink:     silhouettes (bird, cat), a deep tone from the theme's background
//   sprout:  young leaves in spring
//   fireworks: a few colours for the New Year, softened toward white
function derive(p) {
  p = p || fallback()
  var bright = function(h) {
    // Lift dark or greyish colours so a bulb still reads as lit.
    var l = luma(h)
    return l < 0.45 ? mixHex(h, "#ffffff", 0.45 - l) : h
  }
  var hues = [p.red, p.yellow, p.green, p.blue, p.magenta]
  var lights = [bright(p.accent)]
  for (var i = 0; i < hues.length; i++) if (saturation(hues[i]) > 0.25 && hues[i] !== p.accent) lights.push(bright(hues[i]))
  if (lights.length < 3) lights = lights.concat(["#ffc46b", "#ff6b6b", "#7ee8fa"]).slice(0, 4)
  var scarf = saturation(p.accent) > 0.2 ? p.accent : p.red
  // Keep the scarf rich: neither washed out nor near-black.
  var sl = luma(scarf)
  if (sl > 0.72) scarf = mixHex(scarf, "#000000", sl - 0.62)
  if (sl < 0.12) scarf = mixHex(scarf, "#ffffff", 0.2)
  var cool = "#d6e2f2"
  return {
    lights: lights.slice(0, 5),
    scarf: scarf,
    accent: p.accent,
    shadow: mixHex(cool, p.blue, 0.18),
    rim: mixHex("#aac3e6", p.accent, 0.25),
    ink: mixHex(p.mode === "light" ? p.foreground : p.background, "#000000", 0.35),
    sprout: mixHex("#7fb069", p.green, 0.35),
    fireworks: [mixHex(p.yellow, "#ffffff", 0.35), mixHex(p.accent, "#ffffff", 0.3),
                mixHex(p.magenta, "#ffffff", 0.35), mixHex(p.cyan, "#ffffff", 0.4), "#fff6e0"],
    source: p.source || "theme"
  }
}

// Two palettes are the same paint (to skip needless repaints).
function same(a, b) { return !!a && !!b && JSON.stringify(a) === JSON.stringify(b) }
