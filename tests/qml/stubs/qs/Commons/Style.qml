pragma Singleton
import QtQuick
QtObject {
  function space(n) { return n }
  property real cornerRadius: 6
  property var font: ({ family: "sans", caption: 12 })
}
