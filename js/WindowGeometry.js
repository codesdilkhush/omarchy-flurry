// Window geometry model for Snowglobe.
//
// Pure JavaScript: this module never reads Hyprland or Qt. The QML adapter
// collects raw IPC objects into a plain input snapshot; this module turns that
// into a stable internal model with change detection and movement deltas.
// The physics engine receives only this model.

function createState() {
  return {
    revision: 0,
    monitors: ({}),
    windows: ({}),
    gone: [],
    changedMonitors: [],
    changedWindows: []
  };
}

function sameMonitor(a, b) {
  return a && b && a.x === b.x && a.y === b.y
    && a.width === b.width && a.height === b.height
    && a.scale === b.scale && a.reservedTop === b.reservedTop
    && a.reservedBottom === b.reservedBottom
    && a.reservedLeft === b.reservedLeft && a.reservedRight === b.reservedRight;
}

function sameWindow(a, b) {
  return a && b && a.x === b.x && a.y === b.y
    && a.width === b.width && a.height === b.height
    && a.monitorName === b.monitorName && a.workspaceId === b.workspaceId
    && a.floating === b.floating && a.fullscreen === b.fullscreen
    && a.special === b.special && a.focusRank === b.focusRank;
}

// Apply a fresh input snapshot. Returns true only when something meaningful
// changed, so callers can avoid rebuilding surfaces on every IPC refresh.
function update(state, input, dt) {
  var src = input && typeof input === "object" ? input : ({})
  var seconds = dt > 0 ? dt : 1 / 60
  var monitors = Array.isArray(src.monitors) ? src.monitors : []
  var windows = Array.isArray(src.windows) ? src.windows : []
  var changed = false

  var nextMonitors = ({})
  var changedMonitors = []
  for (var m = 0; m < monitors.length; m++) {
    var mon = monitors[m]
    if (!mon || typeof mon.name !== "string") continue
    nextMonitors[mon.name] = {
      name: mon.name,
      id: mon.id,
      x: mon.x,
      y: mon.y,
      width: mon.width,
      height: mon.height,
      scale: mon.scale,
      reservedLeft: mon.reservedLeft || 0,
      reservedTop: mon.reservedTop || 0,
      reservedRight: mon.reservedRight || 0,
      reservedBottom: mon.reservedBottom || 0
    }
    if (!sameMonitor(state.monitors[mon.name], nextMonitors[mon.name]))
      changedMonitors.push(mon.name)
  }
  for (var oldM in state.monitors)
    if (!(oldM in nextMonitors)) changedMonitors.push(oldM)
  if (changedMonitors.length > 0) changed = true

  var nextWindows = ({})
  var changedWindows = []
  for (var w = 0; w < windows.length; w++) {
    var raw = windows[w]
    if (!raw || typeof raw.id !== "string" || raw.id.length === 0) continue
    var prev = state.windows[raw.id]
    var win = {
      id: raw.id,
      monitorName: String(raw.monitorName || ""),
      workspaceId: raw.workspaceId,
      x: raw.x,
      y: raw.y,
      width: Math.max(0, raw.width),
      height: Math.max(0, raw.height),
      floating: raw.floating === true,
      fullscreen: raw.fullscreen === true,
      // Stacking hints: special-workspace windows sit on top, then floating
      // ones, then by focus recency (0 = most recently focused).
      special: raw.special === true,
      focusRank: typeof raw.focusRank === "number" && isFinite(raw.focusRank) ? raw.focusRank : 0
    }
    if (prev) {
      win.dx = win.x - prev.x
      win.dy = win.y - prev.y
      win.dWidth = win.width - prev.width
      win.dHeight = win.height - prev.height
      win.hasMoved = win.dx !== 0 || win.dy !== 0
      win.hasResized = win.dWidth !== 0 || win.dHeight !== 0
      win.movement = Math.sqrt(win.dx * win.dx + win.dy * win.dy)
      // Velocity is derived from the real time between geometry polls. On the
      // first frame or after a long pause the sample is treated as zero motion
      // rather than an unphysical velocity spike.
      win.vx = seconds <= 0.5 ? win.dx / seconds : 0
      win.vy = seconds <= 0.5 ? win.dy / seconds : 0
      win.speed = Math.sqrt(win.vx * win.vx + win.vy * win.vy)
      win.ax = (win.vx - (prev.vx || 0)) / seconds
      win.ay = (win.vy - (prev.vy || 0)) / seconds
    } else {
      win.dx = 0
      win.dy = 0
      win.dWidth = 0
      win.dHeight = 0
      win.hasMoved = false
      win.hasResized = false
      win.movement = 0
      win.vx = 0
      win.vy = 0
      win.speed = 0
      win.ax = 0
      win.ay = 0
    }
    nextWindows[win.id] = win
    if (!prev || !sameWindow(prev, win)) changedWindows.push(win.id)
  }

  var gone = []
  for (var oldW in state.windows)
    if (!(oldW in nextWindows)) gone.push(oldW)
  if (gone.length > 0 || changedWindows.length > 0) changed = true

  state.monitors = nextMonitors
  state.windows = nextWindows
  state.gone = gone
  state.changedMonitors = changedMonitors
  state.changedWindows = changedWindows
  if (changed) state.revision++
  return changed
}

// A lightweight view for the simulation. Returns the state itself: callers
// treat it as read-only and never mutate it.
function snapshot(state) {
  return state
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createState: createState,
    update: update,
    snapshot: snapshot
  };
}
