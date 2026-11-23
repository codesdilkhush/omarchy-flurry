#!/usr/bin/env bash
# Validate the plugin source tree: manifest, entry points, version consistency,
# QML lint (when available) and the Node unit tests. Read-only; changes nothing.
#
# qmllint is looked up in $QT_BIN_DIR, then on PATH, then in /usr/lib/qt6/bin,
# then in a pip-installed PySide6 (which bundles it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
warn() { printf '  warn  %s\n' "$1"; }

command -v python3 >/dev/null || { echo "python3 is required"; exit 2; }

echo "manifest"
python3 - <<'PY' && ok "manifest.json is valid and complete" || bad "manifest.json"
import json, os, sys
m = json.load(open("manifest.json"))
for key in ("schemaVersion", "id", "name", "version", "kinds", "entryPoints"):
    assert key in m, "missing " + key
for kind, rel in m["entryPoints"].items():
    assert os.path.isfile(rel), "entry point missing: " + rel
d = m["barWidget"]["defaults"]
for f in m["barWidget"]["schema"]:
    assert f["key"] in d, "schema key without default: " + f["key"]
PY

echo "version"
mv="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
cv="$(sed -n 's/^var SERVICE_VERSION = "\(.*\)";/\1/p' js/Constants.js)"
lv="$(sed -n 's/^## \[\([0-9.]*\)\].*/\1/p' CHANGELOG.md | head -1)"
if [ "$mv" = "$cv" ] && [ "$mv" = "$lv" ]; then ok "manifest = Constants = CHANGELOG = $mv"
else bad "version mismatch: manifest=$mv constants=$cv changelog=$lv"; fi

echo "qml"
QMLLINT=""
PYSIDE_LINT="$(python3 -c 'import os,PySide6;print(os.path.join(os.path.dirname(PySide6.__file__),"qmllint"))' 2>/dev/null || true)"
for cand in "${QT_BIN_DIR:+$QT_BIN_DIR/qmllint}" "$(command -v qmllint || true)" /usr/lib/qt6/bin/qmllint "$PYSIDE_LINT"; do
  [ -n "$cand" ] && [ -x "$cand" ] && { QMLLINT="$cand"; break; }
done
if [ -n "$QMLLINT" ]; then
  # Quickshell and qs.* types cannot be resolved outside the shell, so most
  # qmllint warnings ([unqualified], [import], [missing-property] on host types)
  # are noise here. Syntax errors and hard errors are what must never ship; note
  # qmllint reports syntax errors as "Warning: ... [syntax]".
  if out="$("$QMLLINT" -I tests/qml/stubs Service.qml BarWidget.qml Panel.qml qml/*.qml qml/components/*.qml 2>&1 \
        | grep -E '\[syntax\]|^Error' | grep -v -E 'Failed to import|Could not find|not found' || true)"; [ -z "$out" ]; then
    ok "qmllint: no syntax errors"
  else
    printf '%s\n' "$out" | head -10; bad "qmllint reported errors"
  fi
else
  warn "qmllint not found (set QT_BIN_DIR); skipped"
fi

echo "tests"
if command -v node >/dev/null; then
  if node --test tests/*.test.js >/tmp/snowglobe-node-tests.log 2>&1; then
    ok "node tests: $(grep -E '^# pass' /tmp/snowglobe-node-tests.log | awk '{print $3}') passed"
  else
    tail -25 /tmp/snowglobe-node-tests.log; bad "node tests failed"
  fi
else
  warn "node not found; unit tests skipped"
fi

echo
[ "$fail" -eq 0 ] && echo "VALID" || { echo "INVALID"; exit 1; }
