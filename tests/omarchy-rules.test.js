// Omarchy's shell rules, checked in the source (agents/skills/shell-dev.md,
// "Keeping state current without polling", and the plugin skill): the
// shell runs all day on battery, so nothing Flurry runs on a timer may cost
// anything while Flurry is off or a fullscreen app hides every scene.
const test = require("node:test")
const assert = require("node:assert")
const fs = require("fs"), path = require("path")
const root = path.join(__dirname, "..")
const read = f => fs.readFileSync(path.join(root, f), "utf8")

// Each `Timer { ... }` block of a QML file, with its running: line.
function timers(src) {
  const out = []
  const re = /Timer\s*\{/g
  let m
  while ((m = re.exec(src))) {
    let depth = 0, i = m.index + m[0].length - 1
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}" && --depth === 0) break
    }
    const body = src.slice(m.index, i + 1)
    const run = /running:\s*([^\n;]+)/.exec(body)
    out.push({ body, running: run ? run[1].trim() : null, repeat: /repeat:\s*true/.test(body) })
  }
  return out
}

test("no repeating timer in the service runs while Flurry is off", () => {
  const src = read("Service.qml")
  for (const t of timers(src).filter(t => t.repeat && t.running)) {
    // Allowed: gated on Flurry running (active, showing), on the friends
    // inbox, or on a one-off preview that stops itself.
    assert.match(t.running, /root\.(active|showing|weatherWanted)/, "timer runs while off: " + t.body.slice(0, 120))
  }
})

test("the window, pointer and client feeds rest while no scene is showing", () => {
  const src = read("Service.qml")
  const ts = timers(src)
  const windowPoll = ts.find(t => /id:\s*windowPoll/.test(t.body))
  assert.ok(windowPoll && /root\.showing/.test(windowPoll.running), "window poll")
  const pointer = ts.find(t => /cursorSocket/.test(t.body))
  assert.ok(pointer && /root\.showing/.test(pointer.running), "pointer socket")
  const clients = ts.find(t => /readClients\(\)/.test(t.body) && t.repeat)
  assert.ok(clients && /root\.showing/.test(clients.running), "client list")
  assert.ok(Number(/interval:\s*(\d+)/.exec(clients.body)[1]) >= 30000, "the client list is event driven, with a slow safety net")
})

test("power: UPower first; /sys is read only where UPower has no battery, and never while off", () => {
  const src = read("Service.qml")
  assert.match(src, /UPower\.displayDevice/)
  const t = timers(src).find(t => /powerProc\.running = true/.test(t.body))
  assert.ok(t, "power timer")
  assert.match(t.running, /root\.active/)
  assert.match(t.running, /!root\.upowerBattery/)
  assert.match(t.running, /sysPower\.battery/)
})

test("no polling the theme file: it is watched", () => {
  const src = read("Service.qml")
  assert.ok(!timers(src).some(t => /themeFile\.reload/.test(t.body)), "theme poll")
  assert.match(src, /id:\s*themeFile[\s\S]{0,200}watchChanges:\s*true/)
})

test("notifications go through omarchy-notification-send", () => {
  const src = read("Service.qml")
  const calls = src.match(/"notify-send"/g) || []
  assert.strictEqual(calls.length, 0, "notify-send called directly")
  assert.match(src, /omarchy-notification-send --app-name Flurry/)
})

test("nothing shows over a fullscreen app but decorating, which the user started", () => {
  const src = read("SceneWindow.qml")
  const vis = /^\s*visible:\s*(.+)$/m.exec(src)[1]
  assert.match(vis, /decorating \|\| \(!fullscreenApp && \(live \|\| busy\)\)/)
  assert.match(src, /function callSanta\(\) \{\s*if \(fullscreenApp\) return false/)
  assert.match(src, /function callYeti\(targetId\) \{\s*if \(fullscreenApp\) return false/)
  assert.match(src, /onVisibleChanged: if \(service\) service\.sceneShown\(screenName, visible\)/)
})

test("a scene that throws every frame starts afresh instead of throwing for the session", () => {
  const src = read("SceneWindow.qml")
  assert.match(src, /\+\+sceneWin\.stepFailures >= 120\) \{ sceneWin\.recoverWorld\(\)/)
  assert.match(src, /sceneWin\.stepFailures = 0/)
})

test("untrusted text in the panel is plain text", () => {
  const src = read("Widget.qml")
  assert.match(src, /component PlainText: Text \{\s*textFormat: Text\.PlainText/)
  assert.ok(!/\bText \{/.test(src.replace("component PlainText: Text {", "")), "a bare Text {} that could render rich text")
})
