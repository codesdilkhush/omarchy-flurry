#!/usr/bin/env bash
# Remove Snowglobe's plugin files.
#
#   ./scripts/uninstall.sh [--target DIR] [--purge-state]
#
# Default removes plugin files only; your settings (shell.json) and saved
# snowmen are kept. --purge-state also deletes $XDG_STATE_HOME/snowglobe.
# The bar entry in shell.json must be removed by hand.
set -euo pipefail

TARGET="${SNOWGLOBE_TARGET:-$HOME/.config/omarchy/plugins/snowglobe}"
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target)      TARGET="${2:?--target needs a directory}"; shift 2 ;;
    --purge-state) PURGE=1; shift ;;
    -h|--help)     sed -n '2,9p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# Refuse to delete anything that is not recognisably this plugin.
if [ -d "$TARGET" ]; then
  grep -q '"id": *"snowglobe"' "$TARGET/manifest.json" 2>/dev/null \
    || { echo "refusing: $TARGET does not look like the Snowglobe plugin" >&2; exit 1; }
  rm -rf "$TARGET"; echo "removed $TARGET"
else
  echo "not installed at $TARGET"
fi
if [ "$PURGE" -eq 1 ]; then
  state="${XDG_STATE_HOME:-$HOME/.local/state}/snowglobe"
  [ -d "$state" ] && { rm -rf "$state"; echo "removed $state"; } || echo "no state at $state"
fi
