#!/usr/bin/env bash
# Install Snowglobe into the Omarchy plugin directory.
#
#   ./scripts/install.sh [--target DIR] [--dry-run] [--skip-validate]
#
# Copies runtime files only (no tests, scripts or docs). An existing install is
# backed up first. shell.json is NEVER modified: add the bar entry yourself.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${SNOWGLOBE_TARGET:-$HOME/.config/omarchy/plugins/snowglobe}"
DRY=0; VALIDATE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --target)        TARGET="${2:?--target needs a directory}"; shift 2 ;;
    --dry-run)       DRY=1; shift ;;
    --skip-validate) VALIDATE=0; shift ;;
    -h|--help)       sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

RUNTIME=(manifest.json Service.qml BarWidget.qml Panel.qml qml js i18n LICENSE README.md CHANGELOG.md)

if [ "$VALIDATE" -eq 1 ]; then "$ROOT/scripts/validate.sh" >/dev/null || { echo "validation failed; run scripts/validate.sh" >&2; exit 1; }; fi

version="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
BACKUPS="${XDG_DATA_HOME:-$HOME/.local/share}/snowglobe/backups"

echo "Snowglobe $version -> $TARGET"
if [ "$DRY" -eq 1 ]; then
  printf '  would copy: %s\n' "${RUNTIME[@]}"; exit 0
fi

if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  mkdir -p "$BACKUPS"
  archive="$BACKUPS/snowglobe-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$archive" -C "$(dirname "$TARGET")" "$(basename "$TARGET")"
  echo "backup: $archive"
fi

mkdir -p "$TARGET"
for item in "${RUNTIME[@]}"; do
  [ -e "$ROOT/$item" ] || continue
  rm -rf "${TARGET:?}/$item"
  cp -a "$ROOT/$item" "$TARGET/$item"
done
echo "installed. The shell hot-reloads on save; otherwise: omarchy-shell shell rescanPlugins"
echo 'bar entry (add by hand if missing): { "id": "snowglobe", "enabled": true, "overlay": "passive" }'
