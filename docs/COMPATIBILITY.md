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

## 3. Unverified (blocked — the Phase 0 machine is a headless Ubuntu container)

Every command in the right-hand column is gathered by `bash poc/env-check.sh`
except the two interactive probes, which need to be started separately.

| Item | Why it is unverified | Command to resolve |
|---|---|---|
| Installed Omarchy version | not installed | `omarchy version` |
| Installed Quickshell version and build flags | not installed | `qs --version` / `pacman -Q quickshell` |
| Installed Qt version | not installed (`qmllint` absent) | `qmllint --version` |
| Installed Hyprland version | not installed | `hyprctl version` |
| Monitor layout, scaling, rotation, refresh rates | no compositor | `hyprctl monitors -j` |
| GPU / renderer / frame timing | no compositor | `qs log` frame stats |
| Click-through actually works on this compositor | needs a live session | `poc/overlay/InputMaskProbe.qml` |
| Geometry staleness during a drag | needs movable windows | `poc/geometry/GeometryProbe.qml` |
| Event names emitted during drag/resize | needs a live session | same probe, histogram |
| Theme token names present in the installed theme | needs installed themes | `~/.local/state/omarchy/current/theme` |

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
