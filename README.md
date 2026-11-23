# Snowglobe

An interactive winter desktop experience for Omarchy: atmospheric snowfall that
settles on window tops and the bottom of each monitor, with an original snowman
builder and persistent decorations. It runs as a native plugin inside the
long-running Omarchy shell — no second Quickshell process, no daemon, no Python,
no browser rendering.

> **Status:** 1.2.0 — stabilisation release with a black-screen guard, part of a
> step-by-step modernisation towards the reference video. The target behaviour is specified in `docs/VIDEO_SPEC.md`
> (with frames in `docs/reference/`); see `CHANGELOG.md` for what changed.

## Features (current)

- Deterministic falling snow with gravity, air resistance, wind gusts, per-flake
  sway and size variation, drawn in one batched Canvas pass per monitor.
- Snow accumulation on active window tops and monitor bottoms using bounded
  height maps; banks slide, redistribute and settle downwind.
- Hyprland geometry tracking via event-driven refresh plus bounded polling;
  surfaces follow windows and are dropped when windows or monitors disappear.
- Window movement physics: attached snow rides along, slides toward the trailing
  edge, and sheds bounded particles with inherited momentum that fall and land.
- Real procedural flake shapes: crisp points for tiny flakes, six-arm crystals
  for medium ones and dendritic snowflakes for the largest.
- Snowman builder: **roll** snowballs by dragging across fallen snow. The ball
  follows the pointer and grows as it picks up the snow it passes over (circle
  over a pile to keep gathering). Release to drop it: on another ball it stacks
  (a head is smaller than the body), elsewhere it starts a new snowman resting
  on the window top or ground below. Then Move (Shift moves the whole snowman),
  Decorate (carrot/eyes/arms/hat/scarf/buttons/mouth) and Delete (or right-click).
  Escape returns any snow you were carrying, exits and restores click-through.
- Snow is drawn in front of windows by default. It settles only where it is
  visible and has room: never over another window, the panel, or off-screen.
- Completed snowmen persist in `$XDG_STATE_HOME/snowglobe/state.json` with
  schema migration and quarantine of corrupt documents.
- Adaptive quality and optional pause-on-fullscreen; 60 Hz physics with 30 Hz
  compositing at low/balanced and 60 Hz at high quality.
- Quality modes with bounded particle counts (250 / 600 / 1200 cap per monitor).
- Bar glyph (❄) with left-click to toggle snowfall and right-click for settings.
- Native settings panel built on Omarchy's `qs.Ui` kit: snowfall, overlay
  surface, draw layer, quality, window snow, builder toggle, live diagnostics
  and a two-step settings reset.
- One transparent, click-through layer surface per monitor; snow never blocks input.
- Versioned settings in the shell's own `shell.json` inline bar entry.
- Strictly validated XDG state document for future persistent decorations;
  invalid data is reported, never silently overwritten.
- Shell IPC control and diagnostics (`snowglobe`, `snowglobe.bar` targets).

## Limitations

- Snowmen stay where they were dropped; they do not follow a window that moves.

- Multi-monitor and hotplug behavior are designed and unit-tested but were not
  hardware-tested: the development machine has one monitor.
- Builder mouse gestures need a human visual review; model and IPC paths are
  covered by automated and live tests.
- Multi-monitor, HiDPI and fullscreen-aware behavior; measured performance.

## Requirements

- Omarchy 4.5+ with the Quickshell plugin host (Quattro contract).
- Quickshell 0.3.2+, Qt 6.12+, Hyprland (Wayland).
- No root, no network, no third-party runtime dependencies.

## Installation

From this source checkout:

```sh
./scripts/install.sh
```

The installer validates the manifest, backs up any existing install to
`$XDG_DATA_HOME/snowglobe/backups/`, and copies runtime files into
`~/.config/omarchy/plugins/snowglobe/`. It **does not modify `shell.json`** —
add or keep the widget in your bar layout yourself:

```json
{ "id": "snowglobe", "enabled": true, "overlay": "passive" }
```

The shell hot-reloads plugin files on save. Force discovery with
`omarchy-shell shell rescanPlugins` if needed.

Useful options: `--dry-run` (show what would be copied), `--target DIR`.

To remove:

```sh
./scripts/uninstall.sh                 # plugin files only; settings and snowmen kept
./scripts/uninstall.sh --purge-state   # also delete saved snowmen
```

Remove the `snowglobe` bar entry from your `shell.json` by hand.

## Usage

- Left-click the ❄ glyph: toggle snowfall (currently toggles the overlay mode).
- Right-click the glyph: open the settings panel.
- Escape closes the panel.

Shell IPC:

```sh
omarchy-shell snowglobe status
omarchy-shell snowglobe builderEnter
omarchy-shell snowglobe builderExit
omarchy-shell snowglobe snowmen
omarchy-shell snowglobe snowmanCreate eDP-1 400 700
omarchy-shell snowglobe deleteSnowman <id>
omarchy-shell snowglobe clearSnowmen
omarchy-shell snowglobe metrics       # per-monitor particles, banks and frame timings
omarchy-shell snowglobe geometry      # tracked windows and rectangles (read-only)
omarchy-shell snowglobe probe         # raw Hyprland model diagnostics
omarchy-shell snowglobe clear         # reset all snow fields
omarchy-shell snowglobe pause
omarchy-shell snowglobe resume
omarchy-shell snowglobe recheckCompositor   # re-run the black-screen check
omarchy-shell snowglobe.bar status
omarchy-shell snowglobe.bar toggle
omarchy-shell snowglobe.bar openPanel
omarchy-shell snowglobe.bar closePanel
omarchy-shell snowglobe.bar configure '{"quality":"high","wind":0.5}'
```

## Settings

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master on/off for the overlay |
| `overlay` | `passive` | `passive` (click-through surface) or `disabled` (no surface) |
| `layer` | `above` | `above` windows (snow falls in front of them) or `behind` them |
| `quality` | `balanced` | `low`, `balanced`, `high` (particle caps 250 / 600 / 1200) |
| `density` | `1` | Snowfall density multiplier (0.2–3) |
| `wind` | `1` | Wind strength (−2–2) |
| `accumulateOnWindows` | `true` | Snow settles on window tops |
| `builderEnabled` | `true` | Snowman builder available |
| `adaptiveQuality` | `true` | Lower particle density automatically if frames run long |
| `pauseOnFullscreen` | `true` | Stop the simulation on a monitor with a fullscreen window |
| `plowEnabled` | `true` | A small snowplough clears the ground snow when it piles up |
| `transparencyGuard` | `true` | Keep the overlay off when the compositor would render it black |

Unknown or invalid values fall back to defaults; out-of-range numbers are
clamped. Settings are written only through the shell's own `updateEntryInline`.

## Troubleshooting

- **The screen goes black when snowfall is on.** Your compositor is not giving
  the shell transparent (alpha) buffers, so the full-screen overlay is drawn
  opaque. This is a Hyprland 0.57.0 default (`quirks:skip_non_kms_dmabuf_formats`)
  that hits VMs and older Intel GPUs. Snowglobe detects it and keeps the overlay
  off (bar tooltip and panel show **Blocked**). To fix it, update Hyprland to
  0.57.1+ or add this to `~/.config/hypr/hyprland.lua`:

  ```lua
  hl.config({ quirks = { skip_non_kms_dmabuf_formats = false } })
  ```

  then restart Hyprland (log out and in) and run `omarchy restart shell`.
  If the screen is already black, turn snowfall off blind from a terminal with
  `omarchy-shell snowglobe.bar toggle` (or `omarchy-shell snowglobe pause`).
  `omarchy-shell snowglobe status` shows the `compositor` probe result.

- **Widget does not appear:** check `omarchy plugin list --json`, then
  `omarchy-shell shell rescanPlugins`.
- **QML errors:** `qs log -p "$OMARCHY_PATH/shell" --tail 100`.
- **Plugin validation:** `./scripts/validate.sh`.
- **`qmllint` not found:** set `QT_BIN_DIR` to the directory containing it
  (on this system `/usr/lib/qt6/bin`).

## Documentation

- `docs/VIDEO_SPEC.md` — the behaviour this plugin is being built to match, with
  a gap analysis and the planned steps.
- `docs/reference/` — frames from the reference video.
- `CHANGELOG.md` — release notes.

## Tests

```sh
./scripts/validate.sh                      # manifest, versions, qmllint, all Node tests
node --test tests/*.test.js                # pure-JS logic and source audits, no desktop
python3 tests/qml/run_all.py               # real QML renderers/service/builder, headless
                                           # (needs: pip install PySide6-Essentials)
python3 tests/qml/compare.py VIDEO.mp4 5.5 out.png   # plugin render next to a video frame
```


## License

MIT — see `LICENSE`.
