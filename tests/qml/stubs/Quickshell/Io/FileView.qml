import QtQuick
QtObject {
  property string path; property bool watchChanges; property bool atomicWrites; property bool printErrors
  signal loaded(); signal loadFailed(); signal saveFailed()
  function text() { return "" }
  function setText(t) { lastWritten = t }
  property string lastWritten: ""
}
