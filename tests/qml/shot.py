#!/usr/bin/env python3
"""Render the QML test scene to PNG for visual inspection."""
import os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
os.environ["QT_QPA_PLATFORM"] = "offscreen"; os.environ["QT_QUICK_BACKEND"] = "software"
sys.path.insert(0, HERE)

# Build svc/Service.qml exactly like run_all.py
src = open("../../Service.qml").read()
a = src.index("  // One surface per screen"); b = src.index("  onModeChanged:"); src = src[:a] + src[b:]
a = src.index("  // ---- Diagnostics / control"); b = src.index("  // ---- Cleanup"); src = src[:a] + src[b:]
src = src.replace("property int surfaceCount: overlayMapped ? overlayVariants.instances.length : 0", "property int surfaceCount: 1")
src = src.replace('import "qml"\n', "")
open("svc/Service.qml", "w").write(src)
for name, target in (("js", "../../../js"), ("qml", "../../../qml"), ("i18n", "../../../i18n")):
    link = os.path.join("svc", name)
    if os.path.islink(link): os.remove(link)
    os.symlink(target, link)

from run2 import boot, report, advance, drag, pump, logs
from PySide6.QtCore import QPoint, Qt

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/qml-shot.png"
view = boot(); root = view.rootObject()
advance(view, 150); pump(800)
view.grabWindow().save(out)
print("saved", out, "logs:", [l for l in logs if "rror" in l or "arning" in l][:3])
