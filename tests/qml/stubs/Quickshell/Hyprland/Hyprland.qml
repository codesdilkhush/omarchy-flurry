pragma Singleton
import QtQuick
QtObject {
  signal rawEvent(var event)
  property var monitors: ({ values: [ {
    id: 0, name: "T-1", x: 0, y: 0, width: 800, height: 500, scale: 1,
    activeWorkspace: { id: 1 },
    lastIpcObject: { reserved: [0, 30, 0, 0], specialWorkspace: { id: 0, name: "" } } } ] })
  property var toplevels: ({ values: [ {
    address: "0x1", workspace: { id: 1 }, monitor: { name: "T-1" },
    lastIpcObject: { mapped: true, hidden: false, at: [200, 150], size: [400, 250],
      workspace: { id: 1 }, floating: true, fullscreen: 0, focusHistoryID: 0, monitor: 0 } } ] })
  function refreshToplevels() {}
}
