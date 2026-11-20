# Snowglobe — Architecture

Status: Phase 0 design. Runtime-dependent items are marked
**[verify]** and correspond to a risk and a PoC in `docs/RISKS.md` /
`poc/`. Nothing here is implemented yet.

Basis: the contract in `omarchy/docs/omarchy-shell.md`, the shell source on
branch `quattro` (`4.0.0.alpha`), and Quickshell master sources. See
`docs/RESEARCH.md` for citations.

---

## 1. Shape of the system

Snowglobe is **one plugin inside the existing `omarchy-shell` process**. It
launches no daemon, no helper process, no second Quickshell instance, and no
native binary. Its runtime artifacts are: one headless `service` entry point
(the simulation and its state), one `bar-widget` (status + panel launcher), and
N `PanelWindow` layer surfaces (one per monitor) created by the service.

```
                    ┌──────────────────────────── omarchy-shell ───────────────────────────┐
 manifest.json      │                                                                      │
   kinds:           │  Service.qml  ── owns ──►  Simulation  ◄── Geometry service          │
   - service   ─────┼─► (entry)                  (pure JS)        (Hyprland IPC, QML only)  │
   - bar-widget ────┼─► BarWidget.qml ──opens──► Panel.qml ──writes──► shell.json entry     │
                    │         │                        │                                    │
                    │         └── commands ────────────┴──► settings, builder mode          │
                    │                                                                      │
                    │  MonitorScene.qml  ×  Quickshell.screens (PanelWindow, per monitor)   │
                    │     ├── FallingLayer   (QtQuick.Particles)                            │
                    │     ├── BankLayer      (Canvas per surface)                           │
                    │     ├── EntityLayer    (bounded Image/Item pool: clumps, snowmen)      │
                    │     └── BuilderLayer   (MouseArea; only in builder mode)              │
                    └──────────────────────────────────────────────────────────────────────┘
```

Everything above `MonitorScene` is simulation and state. Everything below it is
rendering and input. The two meet only through flat data and a handful of
signals, never through object graphs.

---

## 2. Subsystem boundaries

### 2.1 `GeometryService` (QML + `Hyprland` API + `Quickshell.Io.Socket`)

Sole owner of Hyprland knowledge. Publishes a **Hyprland-free** model:

```js
// Monitor snapshot — monitor-local logical coordinates, origin top-left.
{ name: "DP-1", x: 0, y: 0, width: 2560, height: 1440, dpr: 1.0,
  workspace: 1, fullscreen: false, asleep: false, reserved: [0,0,0,0] }

// Surface snapshot — a horizontal ledge snow can rest on.
{ id: "0x55f…:1", kind: "windowTop", monitor: "DP-1",
  x: 120, y: 340, width: 900 }         // monitor-local logical px

// Window rect snapshot — for occlusion and builder hit-testing.
{ id: "0x55f…:1", monitor: "DP-1", x: 120, y: 340, width: 900, height: 600,
  floating: true, fullscreen: 0, workspace: 1 }
```

Rules:

- One shared refresh driver for the whole plugin, never one per monitor and
  never inside a render callback: fast interval while geometry is changing
  (target ≤100 ms), slow interval when idle (≥500 ms), stopped entirely when
  the plugin is disabled or every monitor is paused.
- Fetch via `Hyprland.refreshToplevels()` (one guarded `j/clients` request) and
  read `lastIpcObject.at/size/floating/fullscreen/workspace`; fall back to a
  direct `Quickshell.Io.Socket` client on `.socket.sock` if pipelining control
  is needed. **[verify: poll rate vs. drag staleness — `poc/geometry`]**
- Convert Hyprland global logical coordinates to monitor-local using
  `HyprlandMonitor.x/y`, and derive logical size from `size` with
  `transform % 2` swapping axes. `ShellScreen` has `devicePixelRatio`, not
  `scale` — never assume `scale` exists.
- Diff against the previous snapshot and emit *change events* (`moved`,
  `resized`, `appeared`, `vanished`, `workspaceChanged`, `monitorRemoved`).
  Only changed windows are reported; the physics engine never re-reads
  everything.
- Bound everything: max tracked windows (e.g. 64), max surfaces (e.g. 96),
  drop `hidden`/`unmapped`/zero-size clients, one snapshot retained.
- All fetched data is treated as untrusted input: missing `at`/`size`, wrong
  lengths, non-finite numbers and absurd values are rejected, and a rejected
  entry is skipped rather than allowed to poison the model.

### 2.2 `Simulation` (pure JS, no Qt imports)

Deterministic, headless, testable under `node --test`. Holds:

- **Particle pool**: `Float32Array` for x, y, vx, vy, radius, rotation; `Uint8Array`
  for type/state. Preallocated to the configured maximum. No per-particle QML
  object ever exists.
- **Fixed-step clock**: accumulator at a fixed step (default 1/60 s), with
  `MAX_STEPS_PER_FRAME` clamp and backlog discard after a suspend. Proven in
  `poc/physics` (identical results for 60 FPS and jittery frame pacing).
- **Surface set**: see 2.3.
- **Events out** (consumed by the renderer): `spawned`, `landed`, `detached`,
  `bankChanged(surfaceId)`, each a plain record, coalesced per frame so the
  renderer updates at most once per tick.

The module imports nothing from Quickshell, Qt or the DOM. This is what makes
Phases 2–4 testable without a desktop.

### 2.3 Accumulation model

One `SnowSurface` per ledge:

```
{ id, kind: "ground" | "windowTop",
  monitor, x, y, width,            // monitor-local logical px
  segmentWidth: 2,                 // px per segment
  heights: Uint8Array(segments),   // depth per segment, capped
  total, revision }
```

- Memory is `segments` bytes per surface — bounded by monitor width, not by
  how long the desktop has been running.
- Deposition is a radial stamp at the landing x; sliding is a bounded
  one-pass relaxation into lower neighbours; both conserve snow exactly (tested).
- Windows keep their bank keyed by `address:workspace`. On move they carry
  their bank (the snow travels with the surface); on resize the bank is
  re-segmented on the overlap and the excess is shed as particles; on close
  the bank is released and, if it was floating above nothing, its snow falls.
- Ground banks are one per monitor per workspace, so a workspace switch is a
  swap, not a rebuild.

### 2.4 Renderer (`MonitorScene` per monitor)

| Layer | Technique | Bound |
|---|---|---|
| Falling snow | `QtQuick.Particles` + `ImageParticle`, one `ParticleSystem` per monitor | `maxParticles` per monitor, default ≤600 |
| Accumulation | One narrow `Canvas` per surface, repainted only on `bankChanged` | ≤96 canvases, each width ≤ monitor width |
| Detached clumps | Pooled `Image` items | ≤64 per monitor, recycled, never destroyed |
| Snowmen | `Snowman.qml` component per saved snowman | ≤12 per monitor (enforced) |

Rendering never mutates simulation state; input never mutates it either — both
emit commands that the simulation applies on the next fixed step.

Paused states (fullscreen, battery saver, disabled, monitor asleep) **unmap the
surface** rather than hiding it, so the cost is zero, following
`omarchy-pane`'s rule that a dry day must be free.

### 2.5 `OverlayController` (input modes)

A single explicit state machine, owned by the service (not per monitor):

```
Disabled ──enable──► Passive ──builder──► Builder ──escape/exit──► Passive
   ▲                    │                    │
   └──────disable───────┴────────────────────┘
```

| State | Surface mapped | `mask` | `keyboardFocus` |
|---|---|---|---|
| Disabled | no | — | — |
| Paused (fullscreen/battery/asleep) | no | — | — |
| Passive | yes (or bottom layer) | `Region {}` — click-through | `None` |
| Builder | yes, above windows | full-surface `Region` | `Exclusive` |

Transitions are the only place `mask` is touched, exactly one surface property
changes per transition, and leaving builder mode restores `Region {}` **before**
any other cleanup, so a crash in the builder cannot leave the desktop
swallowing clicks. A watchdog timer force-returns to Passive if builder mode has
been idle and unfocused (defence against a stuck overlay).

### 2.6 `SnowmanModel` (pure JS)

Snowmen are data, not scene objects: `{ id, monitor, x, y, scale, balls: [...],
accessories: [...], createdAt }`. Construction rules (three balls, descending
radius, contact/snap tolerances, no overlap) live in pure functions with tests.
Rendering instantiates `Snowman.qml` from the model. Persistence is a versioned
JSON document, written atomically, never per frame.

### 2.7 Settings and persistence

Deliberately **two stores**, because they have different owners:

| Data | Location | Written by |
|---|---|---|
| User-visible preferences | the plugin's entry in `~/.config/omarchy/shell.json` (bar layout entry + `plugins[]`) | `shell.updateEntryInline(moduleName, settings)`; read back via watched `FileView` |
| Saved snowmen, diagnostics, last-known-good backup | `$XDG_STATE_HOME/snowglobe/state.json` | Snowglobe, atomically |

`shell.json` is canonical for preferences and has no merge layer, so Snowglobe
never rewrites it wholesale — it hands one settings object to the host, which
owns the file. Snowman geometry is not a preference and would bloat
`shell.json`, which is why it lives in state. Every state read is validated;
invalid content is moved aside as `state.corrupt.<timestamp>.json` and defaults
are used, never silently overwritten.

---

## 3. Coordinate systems (one documented rule)

1. **Hyprland global logical** — what `j/clients` `at` and `j/monitors` `x/y`
   use. Origin is the top-left of the leftmost/topmost monitor; values may be
   negative.
2. **Monitor-local logical** — the only space the simulation, surfaces,
   rendering, and pointer events use. `local = global − monitor.x/y`;
   `(0,0)` is that monitor's top-left. All `PanelWindow` children are in this
   space because the surface is exactly the monitor.
3. **Physical** — used only where a device demands it (texture bytes, image
   assets). `physical = logical × devicePixelRatio`.

Conversions live in one module (`js/Geometry.js`) with unit tests, and no other
subsystem may subtract a monitor origin itself. Rotation is handled by swapping
axes when `transform % 2` (the omasnow rule). Mixed-DPI is handled by
`devicePixelRatio` per `ShellScreen`, never a global constant.

---

## 4. Proposed file structure

Verified against both reference plugins and the validator's rules (relative
paths, no symlinks, one entry file per kind):

```
snowglobe/
├── manifest.json                  # kinds: service, bar-widget
├── README.md
├── LICENSE                        # MIT
├── CHANGELOG.md
├── AGENTS.md
├── Service.qml                    # kind: service — owns simulation + overlays
├── BarWidget.qml                  # kind: bar-widget — status, toggle, panel
├── Panel.qml                      # loaded by BarWidget via KeyboardPanel content
│
├── qml/
│   ├── MonitorScene.qml           # one per ShellScreen; layers + input routing
│   ├── FallingLayer.qml           # QtQuick.Particles host
│   ├── BankLayer.qml              # Canvas per surface, retained by surface id
│   ├── EntityLayer.qml            # pooled clumps + snowmen
│   ├── BuilderLayer.qml           # MouseArea, builder-mode only
│   └── components/{Snowman,Snowball,Accessory}.qml
│
├── js/
│   ├── Constants.js               # every tunable default and hard limit
│   ├── Clock.js                   # fixed-step accumulator
│   ├── ParticlePool.js            # typed-array pool + spawn/recycle
│   ├── Simulation.js              # integration, gravity/wind/drag, settling
│   ├── Surfaces.js                # SnowSurface, deposit, settle, re-segment
│   ├── WindowPhysics.js           # move/resize → slide/detach/momentum
│   ├── Geometry.js               # coordinate conversion, monitor mapping
│   ├── SnowmanModel.js            # construction rules, stacking, accessories
│   ├── Settings.js                # defaults, validation, migration, coercion
│   └── State.js                   # atomic read/write, corruption recovery
│
├── assets/{flakes,snowman,accessories,icons}/
│
├── tests/                         # node --test, no desktop required
│   ├── physics/  ├── geometry/  ├── snowman/  ├── settings/
│
├── docs/  RESEARCH.md ARCHITECTURE.md DECISIONS.md COMPATIBILITY.md
│          PERFORMANCE.md SECURITY.md TEST_PLAN.md RISKS.md
│
├── poc/                           # Phase 0 only; removed before release
│
└── scripts/{validate.sh,package.sh}
```

Note: `install.sh` / `uninstall.sh` are deliberately **not** part of the plan.
Omarchy installs plugins with `omarchy plugin add <git-url>` and removes them
with `omarchy plugin remove <id>`; a bespoke installer would be a second,
divergent path. The brief's "reproducible installation" is satisfied by the
official commands, documented in the README.

---

## 5. Lifecycle

**Enable.** Service mounts → validate settings from `shell.json` (fall back to
defaults) → load state → create geometry service → create `MonitorScene` per
`ShellScreen` → begin simulation at Passive. No work at all happens if the
plugin is disabled: no timers, no IPC, no surfaces.

**Disable.** Stop clock → stop geometry service → transition overlay to
Disabled (unmap) → destroy scenes → flush state if dirty → release arrays. User
data is preserved; `shell.json` is untouched.

**Monitor hotplug.** `Quickshell.screensChanged` → drop scenes whose
`ShellScreen` is gone (never reuse a dangling one) → create scenes for new
screens → re-derive geometry → discard surfaces for missing monitors. All
surfaces for a removed monitor are released, and their particle pools are
dropped rather than migrated.

**Shell restart / plugin hot-reload.** State is re-read from disk; nothing in
memory is assumed to survive. `keepLoaded` is **not** used: the surface can be
rebuilt cheaply, and a stale kept instance after a hot-reload would run old
code.

**Error containment.** Every subsystem is entered through a guarded call. A
geometry failure degrades to ground-only snow. A renderer failure in one layer
leaves the others running. A failure in the builder always restores the passive
mask first. No failure path may leave a mapped surface with an empty mask.

---

## 6. Performance budgets (to be measured, not assumed)

| Budget | Target | Measured how |
|---|---|---|
| Frame time, 2 monitors, default quality | ≤ 6 ms (60 FPS with headroom) | `FrameTiming` / `qs log` frame stats |
| Simulation step | ≤ 1.5 ms | `poc/physics` harness on the target machine |
| Geometry refresh, active | ≤ 10 requests/s, one shared | probe counters |
| Geometry refresh, idle | ≤ 2 requests/s | probe counters |
| Idle CPU, snow visible, no windows moving | < 2 % of one core | `pidstat -p $(pgrep -f omarchy-shell)` |
| Idle CPU, paused | ≈ 0 % | same, with surface unmapped |
| Memory | bounded by pool + segments; no growth over 24 h | RSS sampling |
| Startup impact on shell | < 30 ms added | shell start log delta |

The default quality profile must be the one that keeps a laptop responsive:
600 particles/monitor, 2 px segments, ground accumulation on, window
accumulation on, adaptive quality enabled.

---

## 7. Security posture (detail in `docs/SECURITY.md`)

- No network access, ever.
- No subprocess: no `hyprctl`, no `bash -c`, no helper programs.
- No file access outside the plugin's own state directory and the host-owned
  `shell.json` (written only through the host API).
- All persisted input is validated before use; corrupt state is quarantined.
- Bounded everything: particles, surfaces, snowmen, tracked windows, log lines.
- Leaving builder mode is the highest-priority cleanup path.

---

## 8. Phase mapping

| Phase | Builds on this design |
|---|---|
| 1 | manifest, `Service.qml`, `BarWidget.qml`, `Panel.qml`, Settings/State, Passive/Disabled overlay |
| 2 | Clock, ParticlePool, Simulation, FallingLayer, quality profiles |
| 3 | GeometryService, Geometry.js, Surfaces, BankLayer, ground + window tops |
| 4 | WindowPhysics, detachment, momentum, landing → accumulation |
| 5 | Builder state, BuilderLayer, SnowmanModel, Snowman.qml, persistence |
| 6 | profiling, multi-monitor/DPI matrix, docs, packaging |

Each phase ships tests for its own pure modules; no phase may claim a
performance number it did not measure.
