import QtQuick
// Test stand-in for Quickshell.Io.Process. When started it answers like
// `hyprctl -j getoption` on a compositor that offers alpha formats, unless a
// test sets `fakeOutput` first.
QtObject {
  id: proc
  property var command: []
  property bool running: false
  property QtObject stdout: null
  property string fakeOutput: '{"option":"quirks:skip_non_kms_dmabuf_formats","int":0,"set":false}'
  signal exited(int exitCode, int exitStatus)
  onRunningChanged: {
    if (!running) return
    Qt.callLater(function() {
      if (proc.stdout) { proc.stdout.text = proc.fakeOutput; proc.stdout.streamFinished() }
      proc.running = false
      proc.exited(0, 0)
    })
  }
}
