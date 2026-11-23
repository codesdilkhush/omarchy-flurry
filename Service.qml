import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Services.UPower
import qs.Commons
import "lib/store.js" as Store

// Flurry's headless core. Owns the saved state, the per-screen scenes, the
// window and pointer feeds the simulation reads, the visitors' schedule, and
// the friends inbox. The bar widget and the IPC target only talk to this.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string pluginId: manifest && manifest.id ? manifest.id : "itscallssh.flurry"

  // ------------------------------------------------------------------ state

  property var saved: Store.defaults()
  property bool loaded: false
  readonly property bool isOn: saved.enabled
  readonly property string effect: saved.effect
  readonly property real intensity: saved.intensity
  readonly property bool plowOn: saved.plow
  readonly property bool snowballsOn: saved.snowballs
  readonly property var effects: Store.EFFECTS

  // Half the particles, and a 30 fps cap, on battery.
  readonly property bool onBattery: UPower.onBattery
  readonly property real quality: saved.batterySaver && onBattery ? 0.5 : 1

  readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")) + "/omarchy-flurry"

  // Replace the saved state with a changed copy, so bindings see a new object.
  function update(mutator) {
    var next = JSON.parse(JSON.stringify(root.saved))
    mutator(next)
    root.saved = Store.normalize(next)
    saveTimer.restart()
  }

  function setEnabled(on) { update(function(s) { s.enabled = !!on }) }
  function toggle() { setEnabled(!root.saved.enabled) }
  function setEffect(name) {
    if (Store.EFFECTS.indexOf(String(name)) < 0) return false
    update(function(s) { s.effect = String(name); s.enabled = true })
    return true
  }
  function nextEffect(delta) {
    var i = Store.EFFECTS.indexOf(root.saved.effect)
    var n = Store.EFFECTS.length
    setEffect(Store.EFFECTS[((i + (delta || 1)) % n + n) % n])
  }
  function setIntensity(v) { update(function(s) { s.intensity = Number(v) }) }
  function setVisitors(on) { update(function(s) { s.visitors = !!on }) }
  function setPlow(on) { update(function(s) { s.plow = !!on }) }
  function setSnowballs(on) { update(function(s) { s.snowballs = !!on }) }
  function setBatterySaver(on) { update(function(s) { s.batterySaver = !!on }) }

  Process {
    id: makeStateDir
    command: ["mkdir", "-p", root.stateDir]
    running: true
    onExited: stateFile.path = root.stateDir + "/state.json"
  }

  FileView {
    id: stateFile
    printErrors: false
    atomicWrites: true
    onLoaded: {
      var raw = null
      try { raw = JSON.parse(text()) } catch (e) { console.warn("flurry: state.json unreadable, starting fresh") }
      root.saved = Store.normalize(raw)
      root.loaded = true
    }
    onLoadFailed: function(error) {
      root.saved = Store.defaults()
      root.loaded = true
    }
  }

  Timer {
    id: saveTimer
    interval: 800
    onTriggered: if (root.loaded && stateFile.path !== "") stateFile.setText(JSON.stringify(root.saved, null, 2) + "\n")
  }

  // ------------------------------------------------------------ decorations

  // Each scene reports in, so the service can hand a visitor or a delivery to
  // the screen that should show it.
  property var scenes: ({})
  function registerScene(name, scene) {
    var next = Object.assign({}, root.scenes); next[name] = scene; root.scenes = next
  }
  function unregisterScene(name, scene) {
    if (root.scenes[name] !== scene) return
    var next = Object.assign({}, root.scenes); delete next[name]; root.scenes = next
  }
  function focusedScene() {
    var m = Hyprland.focusedMonitor
    if (m && root.scenes[m.name]) return root.scenes[m.name]
    for (var k in root.scenes) return root.scenes[k]
    return null
  }
  function sceneForPlace(place) {
    return (place && root.scenes[place.screen]) || root.focusedScene()
  }

  function addTree(place) {
    if (root.saved.trees.length >= Store.MAX_TREES) {
      notify("Three trees is the limit", "Remove one to grow another.")
      return null
    }
    var t = Store.normalizeTree({ place: place, planted: Date.now() })
    update(function(s) { s.trees.push(t) })
    return t.id
  }
  function addSnowman(place, extra) {
    if (root.saved.snowmen.length >= Store.MAX_SNOWMEN) {
      notify("That's a lot of snowmen", "Remove one to roll another.")
      return null
    }
    var m = Store.normalizeSnowman(Object.assign({ place: place }, extra || {}))
    update(function(s) { s.snowmen.push(m) })
    return m.id
  }
  function addGift(place, extra) {
    var g = Store.normalizeGift(Object.assign({ place: place }, extra || {}))
    update(function(s) { s.gifts.push(g) })
    return g.id
  }
  function listFor(kind) {
    return kind === "tree" ? "trees" : (kind === "snowman" ? "snowmen" : "gifts")
  }
  function find(kind, id) {
    var list = root.saved[listFor(kind)]
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
    return null
  }
  function moveItem(kind, id, place) {
    update(function(s) {
      var list = s[listFor(kind)]
      for (var i = 0; i < list.length; i++) if (list[i].id === id) list[i].place = place
    })
  }
  function removeItem(kind, id) {
    update(function(s) {
      var key = listFor(kind)
      s[key] = s[key].filter(function(x) { return x.id !== id })
    })
  }
  function decorateTree(id, ornament) {
    var done = false
    update(function(s) {
      for (var i = 0; i < s.trees.length; i++) {
        var t = s.trees[i]
        if (t.id !== id) continue
        if (ornament.kind === "star") { t.star = true; done = true; continue }
        if (t.ornaments.length >= Store.MAX_ORNAMENTS) continue
        var palette = ornament.kind === "light" ? Store.LIGHT_COLORS : Store.BAUBLE_COLORS
        t.ornaments.push({ kind: ornament.kind, u: ornament.u, v: ornament.v,
                           color: palette[t.ornaments.length % palette.length] })
        done = true
      }
    })
    return done
  }
  function openGift(id) {
    update(function(s) { for (var i = 0; i < s.gifts.length; i++) if (s.gifts[i].id === id) s.gifts[i].opened = true })
  }
  function clearDecorations() { update(function(s) { s.trees = []; s.snowmen = []; s.gifts = []; s.strings = [] }) }

  // Light strings belong to a window class, so they come back with the app.
  function lightsFor(cls) {
    for (var i = 0; i < root.saved.strings.length; i++) if (root.saved.strings[i].windowClass === cls) return root.saved.strings[i]
    return null
  }
  // Hangs a string on windows of `cls`, or, when it has one, changes its colours.
  function decorateWindow(cls) {
    if (!cls) return ""
    var have = lightsFor(cls)
    if (!have && root.saved.strings.length >= Store.MAX_STRINGS) {
      notify("That's a lot of lights", "Take a string down to hang another.")
      return ""
    }
    var palette = "warm"
    update(function(s) {
      for (var i = 0; i < s.strings.length; i++) {
        if (s.strings[i].windowClass !== cls) continue
        var p = Store.STRING_PALETTES
        palette = s.strings[i].palette = p[(p.indexOf(s.strings[i].palette) + 1) % p.length]
        return
      }
      s.strings.push(Store.normalizeString({ windowClass: cls, palette: palette }))
    })
    return palette
  }
  function removeWindowLights(cls) {
    update(function(s) { s.strings = s.strings.filter(function(l) { return l.windowClass !== cls }) })
  }
  // For `flurry lights`: on the focused window, cycling colours, then off.
  function focusedLights() {
    var t = Hyprland.activeToplevel
    var ipc = t ? t.lastIpcObject : null
    var cls = ipc ? String(ipc["class"] || "") : ""
    if (!cls) return "no window"
    var have = lightsFor(cls)
    if (have && have.palette === Store.STRING_PALETTES[Store.STRING_PALETTES.length - 1]) { removeWindowLights(cls); return "off" }
    return decorateWindow(cls) || "limit reached"
  }

  // Decorate mode turns the overlay on the focused screen interactive.
  property string decorating: ""   // screen name, or "" when off
  function startDecorating() {
    var m = Hyprland.focusedMonitor
    root.decorating = m ? m.name : ""
    if (!root.saved.enabled) setEnabled(true)
  }
  function stopDecorating() { root.decorating = "" }

  // --------------------------------------------------------- window feed
  //
  // Hyprland reports no events while a window is being dragged, so the
  // scenes cannot just wait for one. While the effect is on, the toplevel
  // list is refreshed on a timer that runs fast for a couple of seconds after
  // anything moved and slow otherwise. A refresh is one request on
  // Hyprland's socket, not a process.

  property real lastMotion: 0
  function noteMotion() {
    var idle = Date.now() - root.lastMotion >= 2000
    root.lastMotion = Date.now()
    // Waking from idle: poll fast at once instead of after the idle tick.
    if (idle && windowPoll.running) { windowPoll.interval = root.fastPoll; windowPoll.restart() }
  }
  readonly property bool active: root.loaded && root.saved.enabled

  // While something moves the list is read every frame (about 60 times a
  // second), so the snow physics sees a drag as the smooth motion it is and
  // can tell a gentle drag from a jerk. Two seconds after the last change it
  // drops back to a slow idle rate.
  readonly property int fastPoll: 16
  readonly property int idlePoll: 220
  Timer {
    id: windowPoll
    running: root.active
    repeat: true
    interval: root.idlePoll
    onTriggered: {
      Hyprland.refreshToplevels()
      interval = Date.now() - root.lastMotion < 2000 ? root.fastPoll : root.idlePoll
    }
  }
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      switch (String(event.name)) {
      case "openwindow": case "closewindow": case "movewindowv2": case "changefloatingmode":
      case "fullscreen": case "workspacev2": case "focusedmonv2": case "activewindowv2":
        Hyprland.refreshToplevels()
        root.noteMotion()
      }
    }
  }

  // ---------------------------------------------------------- pointer feed
  //
  // The overlay takes no input, so it cannot see the pointer. The air the
  // pointer drags along scatters snow, leaves and petals and fireflies
  // gather around it, so for those effects it is read from Hyprland's
  // socket, about 20 times a second. Rain and starfall do not need it.

  readonly property bool wantsPointer: root.active && ((root.saved.effect !== "rain" && root.saved.effect !== "starfall") || root.saved.strings.length > 0)
  property var pointer: ({ x: 0, y: 0, vx: 0, vy: 0, present: false, stillFor: 0, at: 0 })
  readonly property string hyprSocket: {
    var dir = Quickshell.env("XDG_RUNTIME_DIR"), sig = Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE")
    return dir && sig ? dir + "/hypr/" + sig + "/.socket.sock" : ""
  }

  Socket {
    id: cursorSocket
    path: root.hyprSocket
    onConnectedChanged: {
      if (!connected) return
      write("cursorpos")
      flush()
    }
    parser: SplitParser {
      onRead: function(line) {
        var m = /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(String(line))
        if (m) root.takePointer(Number(m[1]), Number(m[2]))
      }
    }
  }

  Timer {
    running: root.wantsPointer && root.hyprSocket !== ""
    repeat: true
    interval: 50
    onTriggered: {
      if (cursorSocket.connected) cursorSocket.connected = false
      cursorSocket.connected = true
    }
  }

  function takePointer(x, y) {
    var now = Date.now()
    var p = root.pointer
    var dt = p.at ? Math.max(0.016, (now - p.at) / 1000) : 0.05
    var vx = (x - p.x) / dt, vy = (y - p.y) / dt
    var moved = Math.abs(x - p.x) + Math.abs(y - p.y) > 2
    root.pointer = {
      x: x, y: y,
      vx: p.at ? p.vx * 0.4 + vx * 0.6 : 0, vy: p.at ? p.vy * 0.4 + vy * 0.6 : 0,
      present: true, stillFor: moved ? 0 : p.stillFor + dt, at: now
    }
  }

  // ---------------------------------------------------------- visitors
  //
  // Santa crosses now and then while it snows. The Yeti comes for a snowman
  // when there is one on the ground. Both can be called up over IPC.

  Timer {
    id: santaTimer
    running: root.active && root.saved.visitors && root.saved.effect === "snow"
    interval: 60000 * (8 + Math.floor(Math.random() * 12))
    onTriggered: { root.summonSanta(); interval = 60000 * (8 + Math.floor(Math.random() * 12)); restart() }
  }

  Timer {
    id: yetiTimer
    running: root.active && root.saved.visitors && root.saved.snowmen.length > 0
    interval: 60000 * (10 + Math.floor(Math.random() * 15))
    onTriggered: { root.summonYeti(); interval = 60000 * (10 + Math.floor(Math.random() * 15)); restart() }
  }

  // Sends the plow out on the screen in focus, snow or not.
  function summonPlow() {
    var scene = focusedScene()
    return scene ? scene.callPlow() : false
  }

  function summonSanta() {
    var scene = focusedScene()
    return scene ? scene.callSanta() : false
  }

  function summonYeti() {
    // Go where a ground snowman is, else wherever the user is looking.
    for (var i = 0; i < root.saved.snowmen.length; i++) {
      var m = root.saved.snowmen[i]
      if (!m.place.windowClass && root.scenes[m.place.screen]) return root.scenes[m.place.screen].callYeti(m.id)
    }
    var scene = focusedScene()
    return scene ? scene.callYeti("") : false
  }

  // ---------------------------------------------------------- friends

  readonly property var identity: saved.identity
  readonly property var friends: saved.friends
  readonly property string friendCode: Store.friendCode(saved.identity)

  // The inbox id is drawn from /dev/urandom rather than Math.random.
  Process {
    id: identityProc
    property string name: ""
    command: ["sh", "-c", "od -An -tx1 -N16 /dev/urandom | tr -d ' \\n'"]
    stdout: StdioCollector {
      onStreamFinished: {
        var id = String(text || "").trim()
        if (!/^[a-f0-9]{32}$/.test(id)) { root.notify("Couldn't set up friends", "No randomness from /dev/urandom."); return }
        root.update(function(s) { s.identity = { id: id, name: identityProc.name } })
      }
    }
  }

  function setupFriends(name) {
    if (root.saved.identity) {
      if (name) update(function(s) { s.identity.name = String(name).slice(0, 40) })
      return
    }
    identityProc.name = String(name || Quickshell.env("USER") || "Me").slice(0, 40)
    identityProc.running = true
  }

  function copyFriendCode() {
    if (!root.friendCode) { setupFriends(""); return false }
    Quickshell.execDetached(["wl-copy", root.friendCode])
    notify("Friend code copied", "Send it to a friend who runs Flurry.")
    return true
  }

  function addFriend(code) {
    var f = Store.parseFriendCode(code)
    if (!f) { notify("That isn't a Flurry friend code", "It looks like flurry1:name:…"); return false }
    if (root.saved.identity && f.id === root.saved.identity.id) { notify("That's your own code", ""); return false }
    update(function(s) {
      s.friends = s.friends.filter(function(x) { return x.id !== f.id })
      s.friends.push(f)
    })
    notify("Added " + f.name, "You can send them gifts now.")
    return true
  }

  Process {
    id: pasteProc
    command: ["wl-paste", "--no-newline"]
    stdout: StdioCollector { onStreamFinished: root.addFriend(String(text || "")) }
  }
  function addFriendFromClipboard() { pasteProc.running = true }

  function removeFriend(id) { update(function(s) { s.friends = s.friends.filter(function(x) { return x.id !== id }) }) }

  // Outgoing gifts queue up and go one at a time.
  property var outbox: []
  function post(friendId, message) {
    root.outbox = root.outbox.concat([{ topic: Store.topicFor(friendId), body: JSON.stringify(message) }])
    if (!sendProc.running) sendNext()
  }
  function sendNext() {
    if (!root.outbox.length) return
    var next = root.outbox[0]
    root.outbox = root.outbox.slice(1)
    sendProc.command = ["curl", "-sS", "-f", "-m", "20", "-H", "Content-Type: application/json",
                        "-H", "Cache: yes", "--data-binary", next.body, root.saved.server + "/" + next.topic]
    sendProc.running = true
  }
  Process {
    id: sendProc
    onExited: function(code) {
      if (code !== 0) root.notify("A gift didn't go out", "The train couldn't reach " + root.saved.server + ".")
      root.sendNext()
    }
  }

  function friendById(id) {
    for (var i = 0; i < root.saved.friends.length; i++) if (root.saved.friends[i].id === id) return root.saved.friends[i]
    return null
  }

  // Send what is on the desktop: the train comes for it and it leaves.
  function sendItem(kind, id, friendId) {
    var friend = friendById(friendId)
    if (!friend || !root.saved.identity) return false
    var item = find(kind, id)
    if (!item) return false
    var payload = kind === "tree" ? { star: item.star, size: item.size, ornaments: item.ornaments }
                                  : { scarf: item.scarf, size: item.size }
    var scene = sceneForPlace(item.place)
    var go = function() {
      root.post(friend.id, Store.giftMessage(root.saved.identity, kind, payload))
      root.removeItem(kind, id)
      root.notify("On its way to " + friend.name, "")
    }
    if (scene) scene.trainPickup(kind, id, go)
    else go()
    return true
  }

  function sendNote(friendId, note) {
    var friend = friendById(friendId)
    var text = String(note || "").trim()
    if (!friend || !root.saved.identity || !text) return false
    root.post(friend.id, Store.giftMessage(root.saved.identity, "note", { note: text }))
    var scene = focusedScene()
    if (scene) scene.trainDepart("note")
    notify("Note sent to " + friend.name, "")
    return true
  }

  // Incoming: one long-lived stream of the inbox topic, resumed from the
  // last message seen so nothing sent while the shell was down is lost
  // (ntfy keeps messages for a while).
  readonly property bool inboxWanted: root.loaded && !!root.saved.identity
  property int inboxBackoff: 5

  Process {
    id: inboxProc
    running: false
    command: root.saved.identity
      ? ["curl", "-sS", "-N", "--no-buffer", root.saved.server + "/" + Store.topicFor(root.saved.identity.id)
         + "/json?since=" + root.saved.inboxSince]
      : ["true"]
    stdout: SplitParser {
      onRead: function(line) {
        root.inboxBackoff = 5
        var got = Store.parseInbox(line, root.saved.friends)
        if (!got) return
        root.receive(got.gift)
        if (got.id) root.update(function(s) { s.inboxSince = got.id })
      }
    }
    onExited: if (root.inboxWanted) inboxRetry.restart()
  }

  Timer {
    id: inboxRetry
    interval: root.inboxBackoff * 1000
    onTriggered: {
      root.inboxBackoff = Math.min(120, root.inboxBackoff * 2)
      if (root.inboxWanted) inboxProc.running = true
    }
  }

  onInboxWantedChanged: {
    if (inboxWanted) inboxProc.running = true
    else inboxProc.running = false
  }

  function receive(gift) {
    var scene = focusedScene()
    var who = gift.from + (gift.known ? "" : " (not in your friends)")
    if (scene) scene.trainDeliver(gift)
    else deliverAt(gift, { screen: "", fx: 0.5, fy: 1 })
    notify(gift.kind === "note" ? "A note from " + who : "A gift from " + who,
           gift.kind === "note" ? gift.note : "The little train just dropped it off.")
  }

  // Called by the scene once the train has stopped, with where it stopped.
  function deliverAt(gift, place) {
    if (gift.kind === "snowman" && root.saved.snowmen.length < Store.MAX_SNOWMEN) {
      addSnowman(place, { scarf: gift.art.scarf, size: gift.art.size, from: gift.from })
    } else if (gift.kind === "tree" && root.saved.trees.length < Store.MAX_TREES) {
      var t = Store.normalizeTree({ place: place, star: gift.art.star, size: gift.art.size,
                                    ornaments: gift.art.ornaments, planted: 0 })
      update(function(s) { s.trees.push(t) })
    } else {
      addGift(place, { kind: gift.kind === "note" ? "note" : "gift", from: gift.from, note: gift.note })
    }
  }

  // ---------------------------------------------------------- misc

  function notify(title, body) {
    Quickshell.execDetached(["notify-send", "-a", "Flurry", "-i", "weather-snow", String(title), String(body || "")])
  }

  function status() {
    var scene = focusedScene()
    return JSON.stringify({
      enabled: root.saved.enabled, effect: root.saved.effect, intensity: root.saved.intensity,
      quality: root.quality, trees: root.saved.trees.length, snowmen: root.saved.snowmen.length,
      gifts: root.saved.gifts.length, friends: root.saved.friends.length,
      friendCode: root.friendCode, scene: scene ? scene.stats() : null
    })
  }

  ShellIpc {
    target: "flurry"

    function toggle(): string { root.toggle(); return root.saved.enabled ? "on" : "off" }
    function on(): string { root.setEnabled(true); return "on" }
    function off(): string { root.setEnabled(false); return "off" }
    function effect(name: string): string { return root.setEffect(name) ? name : "unknown effect: " + name }
    function next(): string { root.nextEffect(1); return root.saved.effect }
    function intensity(value: string): string { root.setIntensity(Number(value)); return String(root.saved.intensity) }
    function decorate(): string { root.decorating ? root.stopDecorating() : root.startDecorating(); return root.decorating ? "decorating" : "done" }
    function santa(): string { return root.summonSanta() ? "ho ho ho" : "no screen" }
    function lights(): string { return root.focusedLights() }
    function plow(): string { return root.summonPlow() ? "on its way" : "already out" }
    function snowballs(): string { root.setSnowballs(!root.saved.snowballs); return root.saved.snowballs ? "on" : "off" }
    function yeti(): string { return root.summonYeti() ? "grr" : "no screen" }
    function clear(): string { root.clearDecorations(); return "ok" }
    function friendCode(): string { if (!root.friendCode) root.setupFriends(""); return root.friendCode || "creating, ask again" }
    function setName(name: string): string { root.setupFriends(name); return "ok" }
    function addFriend(code: string): string { return root.addFriend(code) ? "ok" : "invalid code" }
    function note(friend: string, text: string): string {
      var match = null
      for (var i = 0; i < root.saved.friends.length; i++) {
        var f = root.saved.friends[i]
        if (f.name.toLowerCase() === String(friend).toLowerCase() || f.id === friend) match = f
      }
      if (!match) return "no friend called " + friend
      return root.sendNote(match.id, text) ? "sent" : "not sent"
    }
    function status(): string { return root.status() }
  }

  // ---------------------------------------------------------- scenes

  Variants {
    model: Quickshell.screens
    delegate: Component {
      SceneWindow {
        required property var modelData
        screen: modelData
        service: root
      }
    }
  }
}
