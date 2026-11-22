import os, sys, json
os.environ["QT_QPA_PLATFORM"] = "offscreen"
os.environ["QT_QUICK_BACKEND"] = "software"
from PySide6.QtGui import QGuiApplication
from PySide6.QtQuick import QQuickView
from PySide6.QtCore import QUrl, QTimer, QEventLoop, QPoint, Qt, qInstallMessageHandler
from PySide6.QtTest import QTest

logs = []
def handler(mode, ctx, msg): logs.append(msg)
qInstallMessageHandler(handler)

def pump(ms):
    loop = QEventLoop(); QTimer.singleShot(ms, loop.quit); loop.exec()

def boot(qml="svc/TestRoot.qml"):
    app = QGuiApplication.instance() or QGuiApplication(sys.argv)
    view = QQuickView()
    view.engine().addImportPath(os.path.abspath("stubs"))
    view.setResizeMode(QQuickView.SizeRootObjectToView)
    view.resize(800, 500)
    view.setSource(QUrl.fromLocalFile(os.path.abspath(qml)))
    if view.status() != QQuickView.Ready:
        for e in view.errors(): print("QML ERROR:", e.toString())
        raise SystemExit(1)
    view.show(); pump(300)
    return view

def report(view):
    root = view.rootObject()
    root.setProperty("reportTick", root.property("reportTick") + 1); pump(20)
    return json.loads(root.property("reportText"))

def advance(view, seconds):
    root = view.rootObject(); root.setProperty("advanceSeconds", seconds + root.property("advanceSeconds")); pump(300)

def drag(view, pts, step_ms=4):
    """press at pts[0], move through the rest, release at the end (real Qt mouse events)."""
    QTest.mousePress(view, Qt.LeftButton, Qt.NoModifier, QPoint(*pts[0])); pump(step_ms)
    for p in pts[1:]:
        QTest.mouseMove(view, QPoint(*p)); pump(step_ms)
    QTest.mouseRelease(view, Qt.LeftButton, Qt.NoModifier, QPoint(*pts[-1])); pump(30)
