#!/usr/bin/env bash
# Build a reproducible source package and its checksum in ./dist.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
version="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
mkdir -p dist
python3 - "$version" <<'PY'
import os, sys, zipfile
version = sys.argv[1]
out = f"dist/snowglobe-{version}.zip"
skip_dirs = {"dist", ".git", "node_modules", "__pycache__"}
# tests/qml/svc holds one tracked file (TestRoot.qml) beside files that
# run_all.py regenerates (a Service.qml copy and symlinks): ship only the former.
generated = {os.path.join(".", "tests", "qml", "svc", "Service.qml")}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for base, dirs, files in os.walk("."):
        dirs[:] = sorted(d for d in dirs if d not in skip_dirs)
        for name in sorted(files):
            path = os.path.join(base, name)
            if os.path.islink(path) or name.endswith(".pyc") or path in generated: continue
            info = zipfile.ZipInfo(os.path.join("snowglobe", os.path.relpath(path, ".")), (2026, 1, 1, 0, 0, 0))
            info.external_attr = (0o755 if os.access(path, os.X_OK) else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(path, "rb").read())
print(out)
PY
( cd dist && sha256sum "snowglobe-$version.zip" > "snowglobe-$version.zip.sha256" && cat "snowglobe-$version.zip.sha256" )
