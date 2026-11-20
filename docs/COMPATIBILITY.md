# Snowglobe — Compatibility

Two columns matter: what the code was **written against**, and what has been
**observed**. Only the first exists so far.

---

## 1. Reference environment (written against)

| Component | Version | How established |
|---|---|---|
| Omarchy | `4.0.0.alpha`, branch `quattro` | `omarchy/version` in the cloned repo |
| Omarchy shell | in-shell Quickshell, plugin `schemaVersion: 1` | `omarchy/docs/omarchy-shell.md`, `bin/omarchy-plugin-validate` |
| Quickshell | Arch package `quickshell`, unpinned in the Omarchy repo | `omarchy/install/omarchy-base.packages:135` |
| Quickshell API surface | master branch as cloned | `src/window/windowinterface.hpp`, `src/core/region.cpp`, `src/wayland/hyprland/ipc/*`, `src/core/qmlscreen.hpp`, `src/io/socket.hpp` |
| Qt | 6.12 is the version Omarchy's docs call out (the `Color` shadowing note) | `omarchy/docs/omarchy-shell.md` |
| Hyprland | not pinned anywhere in the Omarchy repo | absence confirmed by grep |
| Theme tokens | `qs.Commons` `Color` / `Style` / `Border` | `omarchy/shell/Commons/*` |

Because Omarchy does not pin Quickshell or Hyprland, **compatibility is a
property of the user's machine, not of this document.** Snowglobe must degrade
gracefully rather than assume a build.

---

## 2. Verified behaviours (by reading source)

These are facts about the code, not observations of a desktop:

| Behaviour | Evidence |
|---|---|
| Manifest required fields, id regex, reserved `omarchy.*`, per-kind entry points, no symlinks | `omarchy/bin/omarchy-plugin-validate` |
| `schemaVersion` must be the number `1` | same, plus `PluginRegistry.qml` `manifest.schemaVersion !== 1` |
| Empty `Region` ⇒ `Qt::WindowTransparentForInput` + empty window mask | `quickshell/src/core/region.cpp` `PendingRegion::empty/build`; `src/window/proxywindow.cpp` `onPolished()` |
| `PanelWindow` supports `mask`, `exclusionMode: Ignore`, `WlrLayershell.layer`, `WlrLayershell.keyboardFocus` | `quickshell/src/window/windowinterface.hpp`; used by `omarchy/shell/Ui/OverlayWindow.qml` |
| `HyprlandToplevel` has **no** geometry property/signal; `lastIpcObject` is stale until `refreshToplevels()` | `src/wayland/hyprland/ipc/hyprland_toplevel.hpp` (doc comment), `connection.cpp:749` |
| `movewindowv2` only re-parents workspaces; no resize event exists | `connection.cpp:550–585`, event-name scan |
| `ShellScreen` has `x/y/width/height/devicePixelRatio`, **no `scale`**; dangling screens return defaults | `src/core/qmlscreen.hpp` |
| `Quickshell.Io.Socket` can `write()` and `flush()` | `src/io/socket.hpp:37–43` |
| Settings are inline in `shell.json`, no merge layer, written via `updateEntryInline` | `docs/omarchy-shell.md`; `shell/plugins/panels/clock/BarWidget.qml:55` |
| Third-party plugins are not sandboxed | `agents/skills/shell-dev.md`, `docs/omarchy-shell.md` |
| A layer surface cannot read the framebuffer beneath it | `omarchy-pane/Pane.qml` header comment |

---

## 3. Environment: observed vs still unverified

### 3.1 Observed (measured on the target machine, 2026-11-20)

Collected by `bash poc/env-check.sh` plus `hyprctl`/`pacman` in a live session.
These are recorded outputs, not inferences.

| Component | Observed | Command that produced it |
|---|---|---|
| Omarchy | `4.5.0-3`, installed at `/usr/share/omarchy` | `omarchy version` |
| Kernel / arch | `7.2.15-1-omarchy`, x86_64 | `uname -a` |
| Omarchy shell (Quickshell) | `0.3.2.r7.g2b4501a-1`, revision `2b4501a282689792b62e94f3fb30d8f512324fe6`, reported as *"distributed by Omarchy"* | `qs --version`, `pacman -Q quickshell` |
| Qt | `qt6-base 6.12.0-3`, `qt6-declarative 6.12.0-2` | `pacman -Q qt6-base qt6-declarative` |
| Hyprland | `0.56.2-4`, tag `v0.56.2`, commit `efb50993780079460b0cbed1363e2166a2de1d9f` | `hyprctl version` |
| Session | Hyprland, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY=wayland-1` | `env` |
| Monitor | single `eDP-1`, `1920x1080@60.008`, **`scale=1.25`**, `transform=0`, origin `0,0`, focused | `hyprctl -j monitors` |
| Open clients | 8 | `hyprctl -j clients` |
| `qmllint` | **present** at `/usr/lib/qt6/bin/qmllint`, owned by `qt6-declarative 6.12.0-2` — **not on `PATH`** | `pacman -Qo /usr/lib/qt6/bin/qmllint` |
| `omarchy plugin` verbs | `add clone disable enable list remove update validate` all present | `omarchy plugin --help` |
| Installed plugins | built-ins across `bar`, `bar-widget`, `service`, `overlay`, `panel` kinds | `omarchy plugin list --json` |

Consequences for the design:

- **Fractional scaling is the default state of the target machine** (`scale=1.25`),
  so the `devicePixelRatio` rule in §4.1 is exercised on the primary display, not
  a rare configuration. A 1920-wide logical surface at 1.25 is rendered at 2400
  physical px; all segment counts must derive from the logical width.
- **`qmllint` is installed but not on `PATH`.** The Phase 1 gate must invoke
  `/usr/lib/qt6/bin/qmllint`, not `qmllint`.
- Qt `6.12.0` confirms the `Commons.Color.*` shadowing constraint is live, not
  hypothetical.
- Quickshell is an Omarchy-distributed build (`0.3.2.r7`), so the plugin must not
  assume a Quickshell newer than 0.3.2.

### 3.2 Still unverified

| Item | Why it is unverified | How to resolve |
|---|---|---|
| GPU / renderer / frame timing | `hyprctl -j devices` returned no `.gpus` entries on this machine | `qs log` frame stats; `hyprctl systeminfo` |
| Click-through actually works on this compositor | probe written, not yet run | `quickshell -p poc/overlay/InputMaskProbe.qml` |
| Geometry staleness during a drag | probe written, not yet run | `quickshell -p poc/geometry/GeometryProbe.qml` |
| Event names emitted during drag/resize | probe written, not yet run | same probe, histogram |
| Theme token names present in the installed theme | not inspected | `~/.local/state/omarchy/current/theme` |
| Multi-monitor and mixed-DPI behaviour | single-monitor machine | second output, or a virtual one |

---

## 4. Known coordinate and scaling quirks to design around

1. **No `scale` on `ShellScreen`.** Use `devicePixelRatio`. Hyprland's IPC
   monitor object *does* have `scale`; conflating the two is the single most
   likely source of half-size or double-size bugs.
2. **Negative monitor origins.** A monitor left of or above the primary has
   negative `x`/`y`. All conversion is `local = global − origin`, so negative
   origins are handled by construction; tests must include one.
3. **Rotation.** With `transform % 2`, reported physical width/height swap.
   Handle it once, in `js/Geometry.js`.
4. **Dangling `ShellScreen`.** After a disconnect, stored objects return default
   values and never recover. Key everything by `name` and rebuild on
   `screensChanged`.
5. **Fractional scaling.** Compare scales in 1/120 units
   (`Math.round(dpr * 120)`), as `OverlayWindow.qml` does, to tolerate float
   rounding.
6. **First-frame stretch.** A surface mapped before Qt knows the output scale is
   stretched by the compositor; gate content on size **and** scale as
   `OverlayWindow.qml` does.
7. **Hyprland special workspaces** (`special:scratchpad`) are not normal
   workspaces; windows there must not create ground surfaces.
8. **Fullscreen video/games.** Pause and unmap rather than hide; detect from
   `j/clients` `fullscreen` and/or the `fullscreen>>` socket2 event, following
   omarchy-pane.
9. **DPMS/asleep monitors.** Stop per-monitor simulation rather than rendering
   to an invisible output.
10. **Qt 6.12 `Color` shadowing.** The palette must be referenced as
    `Commons.Color.*`.

---

## 5. Hard requirements

| Requirement | Value |
|---|---|
| Plugin `schemaVersion` | `1` |
| Omarchy plugin `kinds` used | `service`, `bar-widget` |
| Quickshell modules imported | `Quickshell`, `Quickshell.Io`, `Quickshell.Wayland`, `Quickshell.Hyprland`, plus `qs.Commons` (host) |
| Qt modules imported | `QtQuick` (and `QtQuick.Particles` from Phase 2) |
| External binaries invoked | **none** |
| Network access | **none** |
| Elevated privileges | **none** |

---

## 6. What "compatible" will mean at release

Phase 6 may only claim compatibility for configurations where all of the
following were actually run and recorded:

- `omarchy plugin validate` passes;
- `qmllint -I "$OMARCHY_PATH/shell"` passes on every entry point;
- the plugin enables, shows snow, opens its panel, and disables cleanly;
- passive mode passes clicks through and builder mode captures them, including
  `Escape` recovery;
- a two-monitor layout with different scaling and one negative origin renders
  aligned snow;
- fullscreen application pauses and resumes the effect;
- a monitor disconnect while running leaves no stale surface or input region.

Until then, this document stays a plan, not a claim.
