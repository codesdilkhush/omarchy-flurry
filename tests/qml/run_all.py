#!/usr/bin/env python3
"""Headless QML tests for Snowglobe (needs: pip install PySide6-Essentials).

Loads the REAL renderers, the REAL Service.qml (with the Wayland surface and IPC
blocks cut out, and Quickshell/Hyprland replaced by tiny stubs in ./stubs) and
the REAL snowman builder, then drives them with genuine Qt mouse events.
"""
import os, sys, math, json
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
os.environ["QT_QPA_PLATFORM"] = "offscreen"; os.environ["QT_QUICK_BACKEND"] = "software"
sys.path.insert(0, HERE)

# --- build svc/Service.qml from the real one -------------------------------------
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

from run2 import *          # boot, report, advance, drag, pump, logs
from PySide6.QtCore import QObject

failures = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name, extra)
    if not cond: failures.append(name)

def circle(cx, cy, rad, turns, n=40):
    return [(int(cx + rad*math.cos(2*math.pi*k/n)), int(cy + 0.35*rad*math.sin(2*math.pi*k/n))) for k in range(int(turns*n)+1)]

view = boot(); root = view.rootObject()
check("service boots without QML warnings", not [l for l in logs if "arning" in l or "rror" in l], str([l for l in logs if "arning" in l][:2]))
r = report(view)
check("ground and window surfaces exist", {s["id"] for s in r["surfaces"]} == {"ground:T-1", "window:0x1"})

# 1. banks repaint on their own (the original bug: 0 snowy pixels, ever)
advance(view, 150); pump(700)
img = view.grabWindow()
def snowy(x, y):
    c = img.pixelColor(x, y); return c.red() > 200 and c.green() > 200 and c.blue() > 200
ground = sum(snowy(x, 497) for x in range(10, 790, 30)); wtop = sum(snowy(x, 146) for x in range(230, 590, 30))
check("ground snow is painted by the plugin's own frame loop", ground >= 20, f"{ground}/26")
check("window-top snow is painted", wtop >= 10, f"{wtop}/12")
dark = sum(1 for x in range(10, 790, 10) for y in range(440, 500, 6) if (lambda c: c.alpha() == 255 and c.red() < 60 and c.green() < 40 and c.blue() < 40)(img.pixelColor(x, y)))
check("no black pixels in the snow band", dark == 0, str(dark))

# 2. snowman by rolling
root.setProperty("enterTick", 1); pump(100)
r0 = report(view); check("builder active", r0["builder"] is True)
drag(view, circle(100, 480, 70, 3))
r1 = report(view)
check("ball 1 built from the ground pile", len(r1["snowmen"]) == 1 and r0["total"] - r1["total"] > 100, f"removed={r0['total']-r1['total']:.0f}")
b0 = r1["snowmen"][0]["balls"][0]
check("ball radius within bounds", 12 <= b0["r"] <= 58, f"r={b0['r']:.1f}")
pts = circle(700, 480, 60, 2.5)
QTest.mousePress(view, Qt.LeftButton, Qt.NoModifier, QPoint(*pts[0])); pump(4)
for p in pts[1:]: QTest.mouseMove(view, QPoint(*p)); pump(4)
tx, ty = int(b0["x"]), int(b0["y"] - b0["r"] - 10)
for k in range(1, 21): QTest.mouseMove(view, QPoint(int(pts[-1][0]+(tx-pts[-1][0])*k/20), int(pts[-1][1]+(ty-pts[-1][1])*k/20))); pump(4)
QTest.mouseRelease(view, Qt.LeftButton, Qt.NoModifier, QPoint(tx, ty)); pump(40)
sm = report(view)["snowmen"][0]
check("ball 2 stacked on ball 1, smaller", len(sm["balls"]) == 2 and sm["balls"][1]["r"] <= sm["balls"][0]["r"] and sm["balls"][1]["y"] < sm["balls"][0]["y"], str([round(b["r"], 1) for b in sm["balls"]]))

# 3. tiny stroke returns its snow; Escape aborts and returns snow
t0 = report(view)["total"]; drag(view, [(300, 492), (312, 492), (324, 492)])
r2 = report(view); check("tiny stroke: no new snowman, snow returned", len(r2["snowmen"]) == 1 and abs(r2["total"] - t0) < 0.05 * t0)
# Freeze snowfall for this one check: otherwise flakes landing during the
# ~300 ms of synthetic mouse moves can outweigh what the short stroke gathers,
# making "did it pick up snow?" untestable. The builder itself stays active.
root.setSimPaused(True); pump(20)
t0 = r2["total"]; pts = circle(300, 480, 60, 2)
QTest.mousePress(view, Qt.LeftButton, Qt.NoModifier, QPoint(*pts[0])); pump(4)
for p in pts[1:]: QTest.mouseMove(view, QPoint(*p)); pump(4)
mid = report(view)["total"]; QTest.keyClick(view, Qt.Key_Escape); pump(150); r3 = report(view)
QTest.mouseRelease(view, Qt.LeftButton, Qt.NoModifier, QPoint(*pts[-1])); pump(30)
check("Escape returns carried snow and leaves builder", mid < t0 - 20 and r3["builder"] is False and abs(r3["total"] - t0) < 0.12 * t0)
root.setSimPaused(False)

print("\nALL QML TESTS PASSED" if not failures else "\nFAILED: " + ", ".join(failures))
sys.exit(1 if failures else 0)
