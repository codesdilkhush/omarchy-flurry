#!/usr/bin/env python3
"""Side-by-side: a frame of the reference video next to the plugin's own render.

    python3 tests/qml/compare.py hero-3.mp4 5.5 out.png

Needs ffmpeg and PySide6-Essentials. The left half is the video frame (scaled
to 800 px wide), the right half is the real QML scene rendered headlessly by
shot.py. It is a review aid, not a pass/fail test.
"""
import os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))

def main():
    if len(sys.argv) < 4:
        print(__doc__); return 2
    video, stamp, out = sys.argv[1], sys.argv[2], sys.argv[3]
    with tempfile.TemporaryDirectory() as tmp:
        plugin_png, video_png = os.path.join(tmp, "plugin.png"), os.path.join(tmp, "video.png")
        subprocess.run(["python3", os.path.join(HERE, "shot.py"), plugin_png], check=True,
                       stdout=subprocess.DEVNULL)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", stamp, "-i", video,
                        "-frames:v", "1", "-vf", "scale=800:500:force_original_aspect_ratio=increase,crop=800:500",
                        video_png], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video_png, "-i", plugin_png,
                        "-filter_complex", "hstack", out], check=True)
    print("wrote", out)
    return 0

if __name__ == "__main__":
    sys.exit(main())
