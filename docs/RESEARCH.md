# Snowglobe — Phase 0 Research

Status: **Phase 0 research complete on everything reachable from this machine;
the installed-system inspection is blocked and explicitly listed in §11.**
Every claim below is marked with how it was established. "Source-verified" means
the code was read; it does not mean the behaviour was observed on a running
desktop.

---

## 1. Method and what was actually inspected

The brief forbids relying on READMEs, so the reference projects and the Omarchy
shell were cloned and read as source. All clones are under `.research/`
(git-ignored, not shipped):

| Repository | Why | How |
|---|---|---|
| `omacom/omarchy` @ `quattro`, `version` = `4.0.0.alpha` | The plugin host, the contract, the validator, the theme tokens | Cloned, read `shell/`, `bin/`, `docs/`, `config/` |
| `quickshell-mirror/quickshell` @ master | The actual behaviour behind `PanelWindow`, `mask`, `Region`, `Hyprland` IPC | Cloned, read `src/` |
| `cesarfilho/omarchy-abyss` | Architecture reference (Omarchy integration ↔ native app) | Cloned, read `manifest.json`, `Service.qml`, `BarWidget.qml`, `install.sh`, `AGENTS.md` |
| `erikwb/omasnow` | Closest existing product: snow on windows | Cloned, read `Snow.qml`, `MonitorSnow.qml`, `SnowEngine.js`, `SnowBank(s).qml`, `geometry.py` |
| `Bert0424/omarchy-pane` | Transparent click-through weather overlay | Cloned, read `Pane.qml`, `manifest.json` |
| `ogarza/ogarza.plugins.weather` | Shader-based weather rendering | Cloned, read `manifest.json`, file layout, shader inventory |
| `koiart.app` (site + blog) | The product this is inspired by | Read the public site and blog posts (no code, no assets) |

Official documentation read: `omarchy.org/manual/shell-plugins`,
`omarchy.org/plugins/develop`, `omarchy.org/plugins/publish`,
`quickshell.org/docs/types/Quickshell/PanelWindow`. Where the website and the
`quattro` source disagreed, **the source won** — the website documents a
released contract, the branch documents the current one.

---

## 2. The plugin contract (source-verified)

`omarchy/docs/omarchy-shell.md` and `omarchy/bin/omarchy-plugin-validate` agree
on the following, and the validator is a faithful mirror of
`shell/services/PluginRegistry.qml::validateManifest`:

- `schemaVersion` must be the **number** `1`, not the string `"1"`.
- Required: `id`, `name`, `version`, `kinds`, `entryPoints`.
- `id` must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`, must not contain `..`, and
  must not start with `omarchy.` (reserved namespace).
- `kinds` is a non-empty array. Each kind that has a fixed entry-point key must
  declare it, or validation fails:

  | kind | entryPoints key | File | Purpose |
  |---|---|---|---|
  | `bar` | `bar` | `Bar.qml` | Replaces the whole bar |
  | `bar-widget` | `barWidget` | `BarWidget.qml` | Item in the active bar |
  | `menu` | `menu` | `Menu.qml` | Summoned menu |
  | `overlay` | `overlay` | `Overlay.qml` | Fullscreen surface |
  | `panel` | `panel` | `Panel.qml` | Floating surface |
  | `service` | `service` | `Service.qml` | Headless singleton |

- Every entry point must be a relative path, must not contain `..` or a
  newline, and must exist.
- **Symlinks anywhere in the plugin folder are rejected** (`find … -type l`),
  except inside `.git`. Development must therefore be a real directory at
  `~/.config/omarchy/plugins/<id>/`, not a symlink into a checkout.
- `barWidget.defaultSection`, if present, must be one of `left`, `centerBegin`,
  `center`, `centerEnd`, `tray`, `right`.

Sources: `omarchy/bin/omarchy-plugin-validate` (whole file),
`omarchy/shell/services/PluginRegistry.qml` lines 43–104,
`omarchy/shell/plugins/README.md`, `omarchy/docs/omarchy-shell.md` §Plugin
manifest.

### Host injection

Entry points are `Item`s (not `ShellRoot`). The host injects `omarchyPath`,
`shell`, `manifest`, and `pluginRegistry` / `barWidgetRegistry` as properties.
`panel`, `overlay` and `menu` entry points must expose `open(payloadJson)` and
`close()` for `shell summon` / `shell hide`. `keepLoaded: true` keeps an
instance alive between summons and across hot-reload.

Security-relevant nuance, quoted from `omarchy/agents/skills/shell-dev.md`:
third-party plugins receive "capability-scoped facades", but "**these facades
reduce accidental authority but are not a same-process QML sandbox**: a visual
bar widget can walk its parent hierarchy to ordinary host objects." Snowglobe
must therefore assume it runs with full user authority, exactly like any other
third-party plugin, and never depend on the facade for isolation.

### Settings are inline, in `shell.json`

`shell.json` (`version: 1`) holds one entry per plugin instance: bar widgets in
`bar.layout.<section>[]`, everything else in `plugins[]`. Settings are inline on
the entry — "No `config:` sub-object, no merge layers." Built-ins ship defaults
in `config/omarchy/shell.json`; once the user customizes, **`shell.json` is
canonical — there is no deep merge.**

The live write path is `shell.updateEntryInline(moduleName, settings)`, used by
first-party panels themselves (`shell/plugins/panels/clock/BarWidget.qml:55`).
The read path, as used by omasnow, is a `FileView` with `watchChanges: true`
on `$XDG_CONFIG_HOME/omarchy/shell.json`, parsed for `bar.layout.*` and
`plugins[]`.

**Architectural consequence:** Snowglobe must not invent a second settings file
for user preference. Editable preferences belong in its `shell.json` entry
(written with `updateEntryInline`), and the panel reads them back through the
watched file — one source of truth, visibly editable by the user and by
`omarchy bar set`.

### Theme tokens

`qs.Commons` singletons: `Color` (palette + per-surface roles), `Style`
(`cornerRadius`, `gapsOut`, `Style.space()`, `Style.font.*`, `Style.bar.*`,
`Style.duration(ms)`, `Style.reduceMotion`, `Style.easeOut`), `Border`.
`Style.duration()` returns 0 when the user has turned animations off, so **all
Snowglobe animation timing must pass through it**. From
`omarchy/docs/omarchy-shell.md`: Qt 6.12 introduces a `Color` type in `QtQuick`
that shadows unqualified palette references, so the palette must be referenced
as `Commons.Color.*` with `import qs.Commons as Commons`.

---

## 3. Overlay windows and input (source-verified, runtime-unverified)

`PanelWindow` (Quickshell) properties that matter, from
`quickshell/src/window/windowinterface.hpp` and Omarchy's own
`shell/Ui/OverlayWindow.qml`:

- anchors on all four sides + `color: "transparent"` =
  fullscreen transparent layer surface;
- `exclusionMode: ExclusionMode.Ignore` = reserves nothing, so it never pushes
  windows around (the default `Auto` would);
- `WlrLayershell.layer` = `Bottom` | `Top` | `Overlay`;
- `WlrLayershell.keyboardFocus` = `None` | `Exclusive` | `OnDemand`;
- `WlrLayershell.namespace` = a stable name per surface, useful for the
  compositor and for diagnostics;
- `mask` (a `Region`).

### The click-through mechanism is real, and this is exactly how it works

A transparent window is **not** click-through by default: with no mask the
surface receives all pointer input. The behaviour comes from
`ProxyWindowBase::onPolished()` in `quickshell/src/window/proxywindow.cpp`:

```cpp
if (this->pendingPolish.inputMask) {
    QRegion mask;
    if (this->mMask != nullptr) {
        mask = this->mMask->applyTo(QRect(0, 0, this->width(), this->height()));
    }
    this->window->setFlag(Qt::WindowTransparentForInput,
                          this->mMask != nullptr && mask.isEmpty());
    this->window->setMask(mask);
    this->pendingPolish.inputMask = false;
}
```

and `PendingRegion::empty()` / `build()` in `src/core/region.cpp` return a null
`QRegion` for a `Region {}` with no item, zero rect and no sub-regions.

So the three states Snowglobe needs are all expressible and are all
source-verified:

| Mode | `mask` | Result |
|---|---|---|
| Passive snow | `Region {}` | `Qt::WindowTransparentForInput`; every click, drag and scroll passes through |
| Builder | `Region` covering the surface | Clicks land on the overlay |
| Off | unmapped (`visible: false`) | Costs nothing at all |

`omarchy-pane/Pane.qml` already ships `mask: Region {}` on a fullscreen
transparent `PanelWindow` for exactly this purpose, which is the strongest
available evidence short of running it.

**Conflict in the record, and how it is handled:** an open issue in an unrelated
project (`peteonrails/voxtype#440`) reports that a fullscreen transparent
Quickshell surface kept capturing pointer events and that `mask: Region {}`
"did not change behavior". Either that report predates the `inputMask` polish
path above, or its surface differed in a way not visible in the report. Phase 0
does not resolve it by argument: `poc/overlay/InputMaskProbe.qml` is the
experiment, and **passive-mode input pass-through is a Phase 1 acceptance gate,
not an assumption**. If it fails, the fallback is a monitor-splitting overlay
(mask only the bottom strip) plus a short-lived interactive surface for builder
mode, documented in `docs/RISKS.md` R1.

### Opening without a stretched frame

`omarchy/shell/Ui/OverlayWindow.qml` reveals a subtle requirement: a layer
surface mapped before Qt knows the output scale draws a 1×1 frame which the
compositor stretches across the monitor. Omarchy gates content on
`width === targetScreen.width && height === targetScreen.height` **and**
`Math.round(devicePixelRatio * 120) === Math.round(targetMonitor.scale * 120)`,
revealing via `Qt.callLater`. Snowglobe must do the same or the first frame of
snow will be a blur.

---

## 4. Window geometry: the hard part, and what it actually costs

### What Quickshell exposes

`HyprlandToplevel` (`src/wayland/hyprland/ipc/hyprland_toplevel.hpp`) has
`address`, `handle`, `wayland`, `title`, `activated`, `urgent`,
`lastIpcObject`, `workspace`, `monitor`. There is **no `x`, `y`, `width`,
`height` property and no geometry-changed signal.**

Its own doc comment on `lastIpcObject`:

> This is *not* updated unless the toplevel object is fetched again from
> Hyprland. If you need a value that is subject to change and does not have a
> dedicated property, run `Hyprland.refreshToplevels()` and wait for this
> property to update.

### What the event stream delivers

Reading `src/wayland/hyprland/ipc/connection.cpp`, the handled events are
`configreloaded`, `monitorremoved`, `focusedmon`, `renameworkspace`,
`changeworkspaceid`, `fullscreen`, `openwindow`, `closewindow`,
`movewindowv2`, `windowtitlev2`, `activewindowv2`, `urgent`, plus workspace
ones. Critically:

- `movewindowv2` is handled **only to move the toplevel between workspaces**
  (lines 550–585). It does not update `lastIpcObject`, and it is not a
  per-frame position stream.
- Nothing handles a resize event, because **Hyprland has no resize event on
  socket2.** Resizing is invisible to the event stream entirely.

`Hyprland.refreshToplevels()` is the only path that refreshes geometry: it
issues one `j/clients` request, guards against overlap with
`requestingToplevels`, and calls `updateFromObject()` per window, which sets
`bLastIpcObject` (`hyprland_toplevel.cpp`).

### What the incumbents had to do

`erikwb/omasnow` ships `geometry.py`, a **Python** helper that connects to
`.socket.sock` and `.socket2.sock`, polls `j/monitors` + `j/clients` at 10 Hz
while events are flowing, and says so in a comment:

> Events trigger a refresh, bounded to 10 Hz even during event storms. Polling
> also catches drag/resize frames that Hyprland does not announce over socket2.

This independently confirms both facts above, and confirms that **event-driven
window geometry is not achievable on Hyprland today.** Snowglobe will not
inherit the Python helper; it needs an equivalent in QML.

### The QML-only geometry path — the Phase 0 conclusion

`Quickshell.Io.Socket` has `Q_INVOKABLE void write(const QString&)` and
`flush()` (`src/io/socket.hpp` lines 37–43), and omarchy-pane already uses it to
read `.socket2.sock`. Therefore a **pure-QML Hyprland IPC client is possible**:
connect to `.socket.sock`, write `j/clients`, read the reply, parse it. No
Python, no subprocess, no `hyprctl`.

Two candidate implementations, in order of preference:

1. **Bounded adaptive refresh** — call `Hyprland.refreshToplevels()` from one
   shared service: fast (≈100 ms) while geometry is changing, slow (≈500 ms)
   when idle, never from a render callback. Uses only the public API. Cost is
   one `j/clients` round-trip per tick regardless of window count.
2. **Direct socket client** — read `.socket.sock` for `j/clients` directly,
   giving control over request pipelining and letting us keep the last good
   snapshot when a request fails.

Both are PoC-tested before Phase 3 (`poc/geometry/GeometryProbe.qml`) — the
probe measures staleness during a drag, poll cost, and the real event
histogram. **No Rust component is justified by this research**: nothing here
needs a native bridge that Quickshell cannot already reach.

### Coordinate spaces (source-verified types, runtime-unverified values)

- `ShellScreen` (`src/core/qmlscreen.hpp`, QML name `ShellScreen`) exposes
  `name`, `model`, `serialNumber`, `x`, `y`, `width`, `height`,
  `physicalPixelDensity`, `logicalPixelDensity`, `devicePixelRatio`,
  `orientation`. **There is no `scale` property** — a common mistake
  (Hyprland's IPC monitor object does have `scale`; `ShellScreen` does not).
  `x`/`y`/`width`/`height` are in device-independent (logical) pixels.
- Disconnecting a monitor marks stored `ShellScreen`s **dangling**: all
  properties return defaults, and reconnecting does not repair the object. Any
  per-monitor subsystem must key on `name` and rebuild on
  `Quickshell.screensChanged`, never cache the object.
- `HyprlandMonitor` carries Hyprland's own `x`, `y`, `width`, `height`,
  `scale`, `transform`, `activeWorkspace`, and must be the authority for
  Hyprland-side window↔monitor mapping, since `HyprlandToplevel.at` is in
  Hyprland's global logical space.
- omasnow's mapping logic (monitor-local `x = client.at[0] - monitor.x`,
  logical size = `physical / scale`, swap width/height when
  `transform % 2`) is a correct worked example of the same conversion.

---

## 5. Rendering: options, and the evidence for the choice

| Approach | Evidence | Verdict |
|---|---|---|
| QSG custom node / C++ | Requires C++; brief forbids unless compelling | Rejected |
| `Canvas` fullscreen, repaint per frame | A fullscreen texture upload per frame at 1440p is ~8 MB/frame | Rejected for falling snow |
| `Canvas` per narrow bank, repaint on change only | omasnow `SnowBank.qml`: "Only the narrow snow bank uploads a texture when snow lands" | **Adopted for accumulation** |
| `QtQuick.Particles` + `ImageParticle` | omarchy-pane comment: ~1700 particles at once; "instantiating that many items cost ~80% of a core", `ImageParticle` is "a batched GPU quad per particle" | **Adopted for atmospheric snowfall** |
| `Repeater` of `Image`, one item per flake | omasnow ships it at up to 2000; correct but costs per-item QML updates | Bounded use only (detached clumps, ≤~64) |
| `ShaderEffect` + `.qsb` | ogarza ships 18 compiled `.frag.qsb` shaders and drives them from `HyprShader.js` | Viable for a *background* wash; not for per-particle physics |
| Custom shader with particle data in a texture | No supported upload path from JS without C++ | Rejected |

The consequence for the architecture: **two render paths, one simulation.**
Physics owns flat typed arrays; the falling-snow layer is a particle system, the
accumulation layer is one narrow `Canvas` per surface, and only detached clumps
and snowmen become individual items. This is the only structure that keeps a
60 FPS budget plausible without C++.

`WlrLayershell.layer` choice: omasnow deliberately uses `WlrLayer.Bottom` so
the compositor occludes snowfall behind windows with zero IPC latency. KoiArt
ships both a "behind windows" and an "in front" mode. Snowglobe should make the
layer a setting (`Behind windows` / `Above windows`) with **Behind** as the
default: it is the cheap, always-correct option, and it makes the
accumulation-on-window-top illusion survivable even if geometry is a frame
late.

---

## 6. Reference project analysis

### omarchy-abyss — the integration pattern worth copying

Abyss is a Rust game plus a thin Omarchy plugin. Its split is the lesson:
`Service.qml` does idle detection and process launch via `Process`, `BarWidget.qml`
owns all UI and reads state from `FileView`s the binary writes, IPC goes through
`IpcHandler`, and the heavy rendering lives in a separate binary. Its
`install.sh` builds, installs to `$HOME/.local/bin` + XDG data, then runs a
setup step; `uninstall.sh` exists; `packaging/PKGBUILD` and CI workflows exist;
`AGENTS.md` defers to a `docs/DEVELOPMENT.md` with validated commands.

What Snowglobe takes: manifest/entry-point shape, `shell`-injected host usage,
`FileView`-not-poll for state, `IpcHandler` per plugin, a `doctor`-style
diagnostic entry point, and shipping the plugin *inside* the shell process.

What it explicitly does **not** take: the Rust boundary. Abyss needs it because
it renders a scrolling ocean game at high frame rates; Snowglobe's scenes are
compositor-layer surfaces. **Adding Rust would raise maintenance cost with no
verified requirement behind it.**

### omasnow — the anti-pattern and the good parts

Anti-pattern: a Python helper process (`geometry.py`) launched by `Process`.
That is precisely what the brief forbids, and it also means a second failure
domain that must be supervised (`onExited` → retry `Timer` at 5 s).

Good parts worth adopting: per-bank `Canvas` retained by bank id (its comment
explains why a `Repeater` blanks unrelated banks on window churn); the
`Uint8Array` pixel bank plus `Uint16Array` heights; `SplitParser` for the
geometry stream; validation of every setting with explicit ranges in
`configure()`; and **Node-based unit tests** (`tests/engine.test.cjs`,
`settings.test.cjs`) — precedent inside this very ecosystem for testing pure JS
logic outside the shell.

### omarchy-pane — the overlay pattern and honest limits

Ships one click-through `PanelWindow` per screen via `Variants`, unmaps entirely
when there is no weather ("a dry day is genuinely free"), gates on fullscreen by
reading `.socket2.sock` for `fullscreen>>1`, and states a limitation Snowglobe
must repeat in its own docs: **a Wayland layer surface cannot read the
framebuffer beneath it, so refraction is impossible** — "we cannot refract what
is behind the surface". Any glass/frost look must be painted, not sampled.

### ogarza/ogarza.plugins.weather — shaders as a fallback

Uses precompiled `.frag.qsb` shaders (18 of them) driven from `HyprShader.js`,
i.e. a Hyprland screen-shader pipeline rather than a Quickshell surface. That is
a viable escape hatch for a full-screen atmospheric background, but it ties
Snowglobe to Hyprland's shader support and cannot host interactive snow. Noted
as a fallback for R6 (renderer budget), not as a primary path.

---

## 7. KoiArt product study (conceptual only)

From the public site and blog posts (no code, no assets copied):

- Snow accumulates on **window tops, the Dock, and desktop widgets**; dragging a
  window makes it slide off. This is the differentiator, and it matches the
  brief's window-movement physics.
- "Clicks always go straight through the snow" — pass-through is a promise, not
  a mode.
- Separate **"Behind windows"** and **"Keep windows clear"** options per display;
  effects **halve on battery** and **pause behind full-screen apps**.
- Snowmen are **rolled and placed on windows** and "it all stays where you leave
  it" (persistence), plus a snowplough that clears deep snow (`Send snowplough`),
  and a Yeti that steals a snowman — personality layered on physics.
- Interactions are **drag-to-fling** ("Fling a window. The snow flies off.").
- A menu-bar control surface, i.e. a persistent, always-reachable toggle.

Translated into non-negotiable Snowglobe requirements: per-display toggles,
battery/fullscreen throttling, persistent decorations, a fast global disable,
and pass-through as the default state. Deliberately **not** adopted for MVP:
Santa, the train, gift sending, trees, the Yeti, wallpapers.

---

## 8. Installed-system inspection: what could and could not be verifiable

This Phase 0 ran on a cloud Linux VM, not on the Omarchy machine. Facts:

- `cat /etc/os-release` → **Ubuntu 24.04.5 LTS**, not Arch/Omarchy.
- `command -v qs quickshell qml qmllint hyprctl qtpaths6 qmake6 rustc` → **all
  missing**; `jq` and `node` (v26.13.0) are present.
- `sudo -n true` → **"The 'no new privileges' flag is set, which prevents sudo
  from running as root"**, so no Qt/Quickshell/Hyprland could be installed and
  `qmllint` is unavailable.
- `pacman -Qs quickshell`, `dpkg -l | grep -Ei "quickshell|hyprland|qt6"` →
  nothing.

Therefore **the following were not inspected and are not claimed**: the user's
Omarchy version, Quickshell version/build flags, Qt version, Hyprland version,
monitor configuration, refresh rates, GPU, available Quickshell modules on the
installed build, and the installed theme tokens. They are recorded as blocked
in §11 with the exact commands to resolve them.

What *is* established about versions: the reference tree is Omarchy
`4.0.0.alpha` (branch `quattro`), which pins `quickshell` from the Arch repos
(`install/omarchy-base.packages:135`) with no version pin in the repo, and the
Omarchy docs reference **Qt 6.12**. Compatibility must therefore be asserted
against the user's installed versions, not against these.

---

## 9. Validation tooling available without Qt

| Check | Tool | Status |
|---|---|---|
| Manifest schema | `jq`, plus `omarchy plugin validate` on the target machine | `jq` present; validator can be mirrored locally |
| JS logic (physics, models, settings) | `node --test` | Present and used (16/16 pass) |
| QML syntax/type checking | `qmllint -I $OMARCHY_PATH/shell <files>` | **Unavailable here** — required on the Omarchy machine |
| Plugin load, overlay, input | `omarchy plugin validate`, `omarchy-shell shell rescanPlugins`, manual | **Unavailable here** |

`shell-dev.md` gives the canonical pair for plugin work:
`omarchy plugin validate "$PLUGIN_DIR"` and
`qmllint -I "$OMARCHY_PATH/shell" "$PLUGIN_DIR"/BarWidget.qml "$PLUGIN_DIR"/Panel.qml`.

---

## 10. Risk-relevant limits discovered during research

1. No geometry signal and no resize event (§4) — polling is unavoidable.
2. Layer surfaces cannot read the framebuffer (§6) — no true refraction.
3. `ShellScreen` lacks `scale`; dangling monitors return defaults (§4).
4. Third-party plugins are not sandboxed (§2) — Snowglobe is trusted code and
   must behave like it.
5. Settings live in `shell.json` with no merge layer — a malformed write could
   damage shell configuration, so writes must go through `updateEntryInline`
   and never rewrite the file wholesale.
6. Mask behaviour has a contradicting public report (§3) — must be tested.
7. `Style.duration()` returns 0 with animations off — any code that divides by
   an animation duration must tolerate zero.

---

## 11. Blocked verifications (must run on the target machine)

Each needs one command and one recorded line of output. Until they are done,
the corresponding rows in `docs/COMPATIBILITY.md` stay "unverified".

`poc/env-check.sh` runs the read-only half of the list below in one pass and
prints it in pasteable form; it installs nothing, starts no service and changes
no state. Run it in a terminal inside the live session:

```bash
bash poc/env-check.sh
```

The remaining items need a manifest (Phase 1) or an interactive probe run:

```bash
omarchy version; cat /usr/share/omarchy/version
qmllint --version; qs --version; quickshell --version
hyprctl version; hyprctl monitors -j; hyprctl clients -j
pacman -Q quickshell qt6-base qt6-declarative hyprland
omarchy plugin validate .            # after Phase 1 creates the manifest
quickshell -p poc/overlay/InputMaskProbe.qml
quickshell -p poc/geometry/GeometryProbe.qml
```

Acceptance for unblocking Phase 1 is narrow and concrete:

1. `omarchy plugin validate` passes on the manifest.
2. `qmllint` passes on every QML entry point with the shell include path.
3. The input probe shows clicks passing through in passive mode and being
   captured in builder mode, with `Escape` returning to passive.
4. The geometry probe shows how stale window position is during a drag and what
   the event histogram contains — the input to Phase 3's poll rate.
