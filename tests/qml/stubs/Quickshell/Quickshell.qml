pragma Singleton
import QtQuick
QtObject {
  property var screens: [ { name: "T-1", width: 800, height: 500 } ]
  function env(name) { return name === "XDG_STATE_HOME" ? "/tmp/snowglobe-test-state" : "/tmp" }
}
