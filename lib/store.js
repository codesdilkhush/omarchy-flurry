.pragma library

// Flurry's saved state: what the user picked and what they built. Kept in
// $XDG_STATE_HOME/omarchy-flurry/state.json. Everything read from disk or
// from a friend goes through normalize/validate so a hand-edited file or a
// hostile gift can never put the scene into a state the UI cannot draw.

var VERSION = 1
var EFFECTS = ["snow", "leaves", "starfall", "rain", "sakura", "fireflies"]
var MAX_TREES = 3
var MAX_SNOWMEN = 12
var MAX_GIFTS = 24
var MAX_ORNAMENTS = 40
var MAX_FRIENDS = 50
var MAX_STRINGS = 8
var STRING_PALETTES = ["warm", "multi", "cool", "candy"]
var ORNAMENT_KINDS = ["bauble", "light", "candy"]
var BAUBLE_COLORS = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6", "#2ecc71", "#ecf0f1"]
var LIGHT_COLORS = ["#ffd84d", "#ff6b6b", "#7ee8fa", "#b8f28b"]
var DEFAULT_SERVER = "https://ntfy.sh"

function defaults() {
  return {
    version: VERSION,
    enabled: true,
    effect: "snow",
    intensity: 1,
    visitors: true,        // Santa and the Yeti
    batterySaver: true,    // halve the effect on battery
    plow: true,            // a bulldozer clears the ground snow when it piles up
    snowballs: true,       // deep snow and snowballs take the pointer
    trees: [],
    snowmen: [],
    gifts: [],
    strings: [],           // light strings on windows: [{ id, windowClass, palette }]
    identity: null,        // { id, name } once friends are set up
    friends: [],           // [{ id, name }]
    server: DEFAULT_SERVER,
    inboxSince: "all"      // ntfy message id to resume from
  }
}

function str(v, max) { return String(v === undefined || v === null ? "" : v).slice(0, max || 64) }
function num(v, lo, hi, dflt) {
  var n = Number(v)
  if (!isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}
function color(v, palette) {
  var s = String(v || "")
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : palette[0]
}
function uid() {
  var s = ""
  for (var i = 0; i < 8; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s + Date.now().toString(16).slice(-6)
}

// A place on screen that survives restarts: the screen's name, and x/y as
// fractions of its size. Snowmen may instead ride a window, remembered by
// its class so they find it again after a restart.
function normalizePlace(p) {
  p = p || {}
  return {
    screen: str(p.screen, 64),
    fx: num(p.fx, 0, 1, 0.5),
    fy: num(p.fy, 0, 1, 1),
    windowClass: str(p.windowClass, 128),
    windowFx: num(p.windowFx, 0, 1, 0.5)
  }
}

function normalizeTree(t) {
  t = t || {}
  var orn = (t.ornaments instanceof Array ? t.ornaments : []).slice(0, MAX_ORNAMENTS).map(function(o) {
    var kind = ORNAMENT_KINDS.indexOf(o && o.kind) >= 0 ? o.kind : "bauble"
    return {
      kind: kind,
      u: num(o && o.u, -1, 1, 0),
      v: num(o && o.v, 0, 1, 0.5),
      color: color(o && o.color, kind === "light" ? LIGHT_COLORS : BAUBLE_COLORS)
    }
  })
  return { id: str(t.id || uid(), 32), place: normalizePlace(t.place), size: num(t.size, 0.6, 1.6, 1),
           star: !!t.star, ornaments: orn, planted: num(t.planted, 0, 1e13, Date.now()) }
}

function normalizeSnowman(s) {
  s = s || {}
  return { id: str(s.id || uid(), 32), place: normalizePlace(s.place), size: num(s.size, 0.6, 1.6, 1),
           scarf: color(s.scarf, ["#c0392b", "#2980b9", "#27ae60", "#8e44ad"]), from: str(s.from, 40) }
}

function normalizeGift(g) {
  g = g || {}
  return { id: str(g.id || uid(), 32), place: normalizePlace(g.place), kind: g.kind === "note" ? "note" : "gift",
           from: str(g.from, 40), note: str(g.note, 280), color: color(g.color, ["#2e86de", "#c0392b", "#27ae60"]),
           opened: !!g.opened }
}

function normalizeString(l) {
  if (!l || !l.windowClass) return null
  return { id: str(l.id || uid(), 32), windowClass: str(l.windowClass, 128),
           palette: STRING_PALETTES.indexOf(l.palette) >= 0 ? l.palette : "warm" }
}

function normalizeFriend(f) {
  if (!f || !validId(f.id)) return null
  return { id: f.id, name: str(f.name, 40) || "Friend" }
}

function normalize(raw) {
  var d = defaults()
  if (!raw || typeof raw !== "object") return d
  d.enabled = raw.enabled !== false
  d.effect = EFFECTS.indexOf(raw.effect) >= 0 ? raw.effect : "snow"
  d.intensity = num(raw.intensity, 0.25, 2, 1)
  d.visitors = raw.visitors !== false
  d.batterySaver = raw.batterySaver !== false
  d.plow = raw.plow !== false
  d.snowballs = raw.snowballs !== false
  d.trees = (raw.trees instanceof Array ? raw.trees : []).slice(0, MAX_TREES).map(normalizeTree)
  d.snowmen = (raw.snowmen instanceof Array ? raw.snowmen : []).slice(0, MAX_SNOWMEN).map(normalizeSnowman)
  d.strings = (raw.strings instanceof Array ? raw.strings : []).map(normalizeString).filter(Boolean).slice(0, MAX_STRINGS)
  d.gifts = (raw.gifts instanceof Array ? raw.gifts : []).slice(-MAX_GIFTS).map(normalizeGift)
  if (raw.identity && validId(raw.identity.id))
    d.identity = { id: raw.identity.id, name: str(raw.identity.name, 40) || "Me" }
  d.friends = (raw.friends instanceof Array ? raw.friends : []).map(normalizeFriend).filter(Boolean).slice(0, MAX_FRIENDS)
  d.server = validServer(raw.server) ? String(raw.server).replace(/\/+$/, "") : DEFAULT_SERVER
  d.inboxSince = /^[A-Za-z0-9]{1,32}$/.test(String(raw.inboxSince || "")) ? String(raw.inboxSince) : "all"
  return d
}

// ----------------------------------------------------------------- friends
//
// Gifts travel over ntfy (https://ntfy.sh by default, or a self-hosted
// server): each person's inbox is the topic "flurry-<id>", where id is 128
// random bits, so only someone holding the friend code can post to it. A
// friend code is "flurry1:<name>:<id>" and is what people swap.

function validId(id) { return /^[a-f0-9]{32}$/.test(String(id || "")) }
function validServer(s) { return /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?\/?$/.test(String(s || "")) }

function topicFor(id) { return "flurry-" + id }

function friendCode(identity) {
  if (!identity || !validId(identity.id)) return ""
  return "flurry1:" + encodeURIComponent(identity.name || "Friend") + ":" + identity.id
}

function parseFriendCode(code) {
  var m = /^flurry1:([^:]{1,120}):([a-f0-9]{32})$/.exec(String(code || "").trim())
  if (!m) return null
  var name
  try { name = decodeURIComponent(m[1]) } catch (e) { return null }
  return { name: str(name, 40) || "Friend", id: m[2] }
}

// What goes over the wire. art carries just enough to redraw the thing.
function giftMessage(identity, kind, payload) {
  var msg = { v: 1, app: "flurry", kind: kind, from: { id: identity.id, name: identity.name }, at: Date.now() }
  if (kind === "note") msg.note = str(payload && payload.note, 280)
  if (kind === "snowman") msg.art = { scarf: payload && payload.scarf, size: payload && payload.size }
  if (kind === "tree") msg.art = { star: !!(payload && payload.star), size: payload && payload.size,
                                   ornaments: payload && payload.ornaments }
  if (payload && payload.note && kind !== "note") msg.note = str(payload.note, 280)
  return msg
}

// Validate an incoming ntfy event line. Returns { id, gift } or null.
function parseInbox(line, friends) {
  if (String(line).length > 16384) return null
  var ev
  try { ev = JSON.parse(line) } catch (e) { return null }
  if (!ev || ev.event !== "message" || typeof ev.message !== "string") return null
  var msg
  try { msg = JSON.parse(ev.message) } catch (e2) { return null }
  if (!msg || msg.app !== "flurry" || msg.v !== 1 || !msg.from || !validId(msg.from.id)) return null
  if (["snowman", "tree", "note"].indexOf(msg.kind) < 0) return null
  var known = null
  for (var i = 0; i < (friends || []).length; i++) if (friends[i].id === msg.from.id) known = friends[i]
  return {
    id: /^[A-Za-z0-9]{1,32}$/.test(String(ev.id || "")) ? String(ev.id) : "",
    gift: {
      kind: msg.kind,
      fromId: msg.from.id,
      from: known ? known.name : (str(msg.from.name, 40) || "Someone"),
      known: !!known,
      note: str(msg.note, 280),
      art: msg.art && typeof msg.art === "object" ? msg.art : {}
    }
  }
}

function newIdentity(name) {
  var id = ""
  for (var i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16)
  return { id: id, name: str(name, 40) || "Me" }
}
