#!/usr/bin/env bash
# Snowglobe Phase 0 environment probe.
#
# Read-only: runs no build, installs nothing, writes nothing outside stdout,
# starts no Quickshell instance, sends no compositor commands that change state.
#
# Run inside a terminal in your live Hyprland/Omarchy session:
#   bash poc/env-check.sh
# Then paste the whole output back into the chat.
#
# Nothing here should be secret, but review before pasting: it includes your
# monitor layout, GPU name and the plugin entries from shell.json.

set -u

hr() { printf '\n===== %s =====\n' "$1"; }
# run a command, print a MISSING marker instead of failing the script
try() {
  local label=$1
  shift
  printf -- '--- %s ---\n' "$label"
  if command -v "$1" >/dev/null 2>&1; then
    "$@" 2>&1 | head -40
  else
    printf 'MISSING: %s\n' "$1"
  fi
}

hr "1. SYSTEM"
cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME|VERSION_ID)='
printf 'kernel: %s\n' "$(uname -r)"
printf 'arch:   %s\n' "$(uname -m)"
printf 'session: XDG_CURRENT_DESKTOP=%s  XDG_SESSION_TYPE=%s\n' \
  "${XDG_CURRENT_DESKTOP:-}" "${XDG_SESSION_TYPE:-}"
printf 'wayland: WAYLAND_DISPLAY=%s\n' "${WAYLAND_DISPLAY:-}"
printf 'hyprland sig: %s\n' "${HYPRLAND_INSTANCE_SIGNATURE:-}"
printf 'OMARCHY_PATH=%s\n' "${OMARCHY_PATH:-}"

hr "2. OMARCHY"
try "omarchy version" omarchy version
try "omarchy --help" omarchy --help
printf -- '--- omarchy plugin subcommands ---\n'
(omarchy plugin --help 2>&1 || omarchy help plugin 2>&1) | head -40

hr "3. OMARCHY INSTALL LOCATION"
for d in "${OMARCHY_PATH:-/nonexistent}" "$HOME/.local/share/omarchy" /usr/share/omarchy; do
  [ -d "$d" ] && printf 'FOUND %s\n' "$d"
done
printf -- '--- shell.json ---\n'
SJ="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/shell.json"
if [ -f "$SJ" ]; then
  printf 'path: %s (%s bytes)\n' "$SJ" "$(wc -c <"$SJ")"
  if command -v jq >/dev/null 2>&1; then
    jq '{version, bar: .bar.layout, plugins}' "$SJ" 2>&1 | head -60
  else
    printf 'jq MISSING, showing first 2000 bytes\n'
    head -c 2000 "$SJ"
  fi
else
  printf 'MISSING: %s\n' "$SJ"
fi

hr "4. QUICKSHELL / QT"
try "qs --version" qs --version
try "quickshell --version" quickshell --version
try "qtpaths6 --qt-version" qtpaths6 --qt-version
try "qmllint --version" qmllint --version
try "qmake6 --version" qmake6 --version
printf -- '--- running quickshell processes ---\n'
pgrep -a quickshell 2>&1 | head -10 || printf 'none\n'
printf -- '--- qs internals dir (QML imports) ---\n'
for d in /usr/lib/qt6/qml /usr/lib64/qt6/qml /usr/lib/x86_64-linux-gnu/qt6/qml; do
  [ -d "$d" ] && printf 'FOUND %s\n' "$d"
done
[ -d /usr/lib/qt6/qml/Quickshell ] && ls /usr/lib/qt6/qml/Quickshell | head -20

hr "5. HYPRLAND"
try "hyprctl version" hyprctl version
try "hyprctl -j monitors" hyprctl -j monitors
try "hyprctl -j devices" hyprctl -j devices

hr "6. SLIM: MONITORS AND GPU (one-line summary)"
if command -v jq >/dev/null 2>&1 && command -v hyprctl >/dev/null 2>&1; then
  hyprctl -j monitors 2>/dev/null | jq -r '.[] | "\(.name) \(.width)x\(.height)@\(.refreshRate) scale=\(.scale) transform=\(.transform) x=\(.x) y=\(.y) focused=\(.focused)"'
  printf -- '--- gpus ---\n'
  hyprctl -j devices 2>/dev/null | jq -r '.gpus[]? | "\(.name) driver=\(.driver)"'
fi

hr "7. PLUGIN CONTRACT IN INSTALLED OMARCHY"
for f in plugin-validate plugin-install plugin-list; do
  for d in "${OMARCHY_PATH:-/nonexistent}" "$HOME/.local/share/omarchy" /usr/share/omarchy; do
    [ -f "$d/bin/omarchy-$f" ] && printf 'FOUND %s\n' "$d/bin/omarchy-$f"
  done
done
printf -- '--- installed plugins ---\n'
(omarchy plugin list 2>&1 || printf 'no "omarchy plugin list" in this version\n') | head -40

hr "8. INPUT MASK CANDIDATE (read-only inspect)"
printf 'This probe needs a live Quickshell; run it separately, see poc/README.md:\n'
printf '  quickshell -p poc/overlay/InputMaskProbe.qml\n'
printf '  quickshell -p poc/geometry/GeometryProbe.qml\n'

hr "DONE"
printf 'Paste everything from "===== 1. SYSTEM =====" to here.\n'
