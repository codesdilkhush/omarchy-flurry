# Changelog

All notable changes to Snowglobe are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semantic versioning.

## [1.2.0] — 2026-11-23 — Black-screen guard, cleanup and bug fixes

### Fixed

- **Full-screen black overlay.** On Hyprland 0.57.0 (and any config that still
  sets `quirks:skip_non_kms_dmabuf_formats = true`), VMs with virtio-gpu and
  Intel Gen6–Gen8 GPUs are offered no alpha-capable buffer formats. Qt then
  creates the overlay as XR24 and every transparent pixel comes out opaque
  black, hiding the whole desktop. No client-side surface flag can fix that, so
  Snowglobe now asks `hyprctl` once at start-up and **does not map the overlay**
  when the compositor would strip alpha (mode `blocked`). The bar tooltip and
  the settings panel say why and how to fix it. Nothing is mapped until the
  probe answers (≤1.5 s), so there is no black flash either. A new
  **Black-screen guard** setting (`transparencyGuard`, default on) turns the
  check off for setups known to be fine.
- **Surfaces are mapped only once fully configured.** The layer surface waits
  one event-loop turn after creation, so colour, transparent surface format,
  layer and input mask are all applied before the compositor sees a buffer.
- **The simulation kept running while snowfall was off or paused.** An Item's
  `visible` stays true when its window is hidden, so the frame loop, the physics
  and four full-screen canvases kept working at 30 Hz with nothing on screen.
  `MonitorScene` now stops with its window and does not replay the gap as one
  big step when it comes back.
- **Fullscreen pause froze a frame of snow in mid-air.** Flakes and the plough
  are hidden while a monitor is paused.
- **Adaptive quality collapsed after a quality change.** The frame budget was
  fixed when the simulation was created; going from High to Balanced measured
  33 ms frames against a 16 ms budget, read a permanent overrun and throttled
  the snowfall to 40%. `setQuality()` now updates the budget, and the frame
  loop and the metric share one `frameIntervalFor()`.
- **Opening or closing a window did not trigger fast geometry polling.** The
  event list named `windowadded`/`windowremoved`, which Hyprland never sends.
  It now uses the real names (`openwindow`, `closewindow`, …) and accepts
  versioned variants (`movewindowv2`, `workspacev2`).
- **Rotated (portrait) monitors** had width and height swapped in the ground
  and window model; Hyprland's transform is now applied.
- **Resolution/scale changes** without a screen being added or removed left the
  particle field at the old size; it is re-synced on every geometry round.
- **Builder mode could be entered with the overlay disabled**, and stayed armed
  through a pause, so an exclusive-keyboard surface could reappear later. It
  now requires a mapped overlay and exits when the overlay goes away or the
  builder is switched off in settings.
- Service version fell back to a stale `"0.1.0"` without a manifest.

### Changed

- Settings panel rewritten around a reusable `SettingRow` component and a
  data-driven diagnostics list (about 40% less QML, same rows), plus the new
  guard switch and a Transparency diagnostic.
- `snowglobe status` reports `compositor`, `compositorReason` and
  `transparencyGuard`; new `snowglobe recheckCompositor` IPC call.
- Removed the `plowTotal` alias and the misleading `geometryPoll` binding.

### Added

- `js/Compositor.js` (pure, unit-tested probe parsing and gating).
- `tests/blackscreen.test.js`; QML tests for the guard, builder exit and the
  hidden-overlay frame loop; `Process`/`StdioCollector` test stubs.

## [1.1.2] — 2026-11-22 — Step 1: Stabilize

First of a step-by-step modernisation towards the reference video
(see `docs/VIDEO_SPEC.md`). This release changes no visuals on purpose.

### Fixed

- **`plowEnabled` was reset by every bar write.** `Settings.toEntry()` copied a
  hand-written list of keys that omitted it, so toggling snowfall or calling
  `snowglobe.bar configure` silently put the plough back to its default. The key
  list is now derived from `DEFAULTS`, so a future setting cannot be forgotten.
- **Manifest drift.** `plowEnabled` was missing from the manifest defaults and
  schema; it is now declared (as a boolean, a type the schema already uses).
- **Idle canvases were repainted every tick.** The pressed-track and plough
  canvases each uploaded a full-screen texture ~30 times per second even when
  nothing was drawn on them. They now repaint only while they hold something,
  plus one clearing pass. The flake and bank canvases are unchanged.
- Removed `STATE_VERSION` / `MAX_STATE_BYTES` from `Constants.js`: stale copies of
  values that `State.js` owns (the copy said schema 1, the real one is 2).
- **Abandoning a snowball destroyed the snow it had gathered.** Pressing in a pile
  and rolling while the pointer was more than ~12 px under the pile's surface,
  then pressing Escape / releasing a stroke too small to keep / losing the press,
  gave back **0%** of the snow and left a permanent dent. `returnSnow()` only
  looked for a surface at or below the ball, but the ball sits *inside* the pile.
  It now finds the surface whose snow contains the ball (`Collision.surfaceHolding`),
  and any remainder that does not fit back as a mound is spread wider and finally
  poured into the nearest free space (`SnowBank.fillNearest`), so snow is lost only
  when the bank is genuinely full. Measured with the roller in pure JS: deep pile
  0% → 100% returned, pile at its limit 60% → 100%.
- **A QML test that failed ~50% of runs (8/8 on the original).** "Escape returns
  carried snow" paused the whole simulation to stop snowfall, but the rolling ball
  advances inside that same physics step, so the roller was frozen too and the
  check only measured how much snow lay under the press point. It now stops only
  snow landing and the plough (`setSnowFrozen`). Its tolerance was 12% of the
  whole pile (~25x the amount being tested) and is now 5% of the carried snow; the
  tiny-stroke check went from 5% of the pile to 10 units. Both fail every time
  when the old `returnSnow()` is put back.

### Added

- `tests/stability.test.js`: settings round-trip, manifest/Settings/CHANGELOG
  consistency, i18n key audit, QML-JS syntax audit, canvas-gating audit.
- `tests/snow-return.test.js`: snow conservation when a rolled ball is abandoned
  (deep pile, pile at its limit, window cap above must not steal the snow, full
  bank must not be overfilled).
- QML test: idle track/plough canvases perform no repaints; rolling a ball wakes
  the track canvas. Paint counters are exposed on `MonitorScene`.
- `tests/qml/compare.py`: renders the plugin next to a frame of the reference video.
- Settings panel: a **Snowplough** switch for `plowEnabled`, which had no UI at all.
- `scripts/` (install, uninstall, validate, package) and `docs/VIDEO_SPEC.md`,
  which the README already referenced but the archive did not contain.

## [1.1.1] — 2026-11-22 — Transparent overlay fix and video-matched snow look

### Fixed

- **Black fullscreen overlay.** The layer surface now explicitly requests
  `surfaceFormat.opaque: false` when it is created, so Quickshell cannot infer an
  opaque surface format before `color: "transparent"` is applied. All Canvas
  layers keep Qt's portable `Canvas.Image` backing store instead of
  `Canvas.FramebufferObject` (ignored since Qt 6, and a source of black/stale
  textures on transparent Wayland layers), and every paint pass resets its
  composite mode and alpha.
- Ground snow keeps a thin continuous lip along the screen bottom even when the
  height map is nearly empty, matching the reference desktop and fixing a
  headless test that saw only half the bottom samples as snowy.
- Made the QML abort-path test independent of how much snow a short stroke
  happens to gather (the snow-return behaviour itself was already correct).

### Changed — visual pass against the reference video

- Flakes are soft round points with a faint halo; six-arm crystals are reserved
  for the few large detached chunks instead of sparkling across the whole sky.
- Window caps and ground mounds use smoothed, deterministic pillowy crests with
  a cool contact line and a bright lip instead of flat rectangular slabs.
- The bulldozer is now the small bright-orange vehicle from the video, with dark
  spoked tracks, a light-blue cab window, a beacon and a white scoop blade.
- Snowballs and snowmen use a softer, less metallic gradient and subtler
  rolling bands.

### Added

- `tests/render.test.js` locks in the transparent canvas/surface contract and
  the soft-flake rendering. QML and Node suites both pass.

## [1.1.0] — 2026-11-22 — Fixes: snow on windows, the ground, and drag-to-roll snowmen

### Fixed

- **Accumulated snow was never repainted.** The bank canvas watched
  `simulation.bankRevision` through a QML binding, but the simulation is a plain
  JS object, so QML never re-evaluated it: the canvas painted once, before any
  snow had landed, and then stayed frozen. A single frame loop in `MonitorScene`
  now advances the simulation and polls the revision; the bank canvas repaints on
  change (rate-limited), when it becomes visible/available again, and on a slow
  heartbeat that heals a lost texture.
- **Snow fell behind windows.** The default layer was `behind`, so flakes were
  hidden by the windows they should settle on, and Hyprland window shadows were
  drawn over the banks. The default is now `above`. Old installs stored
  `"layer": "behind"` explicitly; a one-time settings revision migrates them,
  after which a deliberate choice is respected.
- **Flakes were consumed at the first window edge**, so no snow was ever seen in
  front of a window body. Half of the flakes now fall across the whole screen
  without settling.
- **Snow overlapped other windows and the panel.** Every surface now has
  per-segment limits derived from free space above it and stacking order:
  covered, off-screen or squeezed segments hold no snow.
- **Wind built a pillar** (up to the full bank depth) at the downwind end of every
  window and the screen. Snow now blows off the edge instead.
- `DisplayMath.reservedArea` used `Array.isArray` on a `QVariantList`, so the
  panel's reserved area was always zero.
- `fullscreen` is a number in current Hyprland (0/1/2/3): maximized windows are no
  longer treated as fullscreen, real fullscreen is detected; pinned windows and
  visible special workspaces are tracked.
- Bank canvas no longer fills a slab below the ground line; paint state is fully
  specified on every pass.

### Added

- Roll tool (`js/SnowRoll.js`, `SnowBallItem.qml`): drag across snow to gather it
  into a growing snowball; drop to place or stack. Snow taken from the piles is
  removed from them, and returned if the ball is too small or abandoned.
- `snowmanDrop` and `snowGather` IPC calls for scripted testing.
- `tests/regression.test.js` (18 tests) and headless QML tests in `tests/qml`.

### Changed

- Deposits are broader mounds (`DEPOSIT_SPREAD` 6) and deeper (`DEPOSIT_AMOUNT` 2.4)
  to compensate for pass-through flakes; window/ground caps are 26/56 px.
- The click-to-create "Ball" tool is replaced by "Roll".

## [1.0.0] — 2026-11-21 — Phase 6: Production Quality and Release

### Added

- `js/DisplayMath.js`: pure logical/physical coordinate conversion, unit-tested
  with synthetic multi-monitor, mixed-scale and negative-origin layouts.
- Adaptive quality governor driven by step + paint + frame drift; particle
  density is reduced automatically when the frame budget is exceeded and
  restored when headroom returns.
- Optional pause-on-fullscreen per monitor.
- Keyboard accessibility on builder HUD buttons (Tab, Return/Space, Accessible role/name).
- `scripts/profile.sh` for read-only CPU/RSS sampling; package checksums;
  version/documentation consistency gate in `validate.sh`.

### Changed

- Falling-snow compositing reduced to 30 Hz for low/balanced quality while the
  fixed-step physics remains at 60 Hz. Measured whole-shell CPU dropped from
  56–76% to 26–28% of one core on the test machine.

### Fixed

- Installer no longer prints a backup path on a fresh install.
- `package.sh` no longer exits with SIGPIPE under `pipefail`.

### Verified

- 82/82 Node tests, manifest + qmllint clean, isolated install/uninstall test,
  reproducible package + checksum, 30 s CPU/RSS profile with stable memory.

## [0.5.0] — 2026-11-21 — Phase 5: Snowman Builder

### Added

- `js/SnowmanModel.js`: creation, stacking with automatic snap/positioning,
  dragging, whole-snowman translation, decorations by ball index and deletion.
- `qml/SnowmanBuilder.qml` + `qml/components/BuilderToolButton.qml`: interactive
  surface with Ball/Move/Decorate/Delete tools, seven accessories, confirmation
  for deletion, HUD and Escape-to-exit.
- `qml/SnowmanRenderer.qml`: original vector snowmen (shaded balls, carrot,
  eyes, twig arms, hat, scarf, buttons, mouth), revision-gated per monitor.
- State schema v2 with balls/decorations, v1 migration, atomic writes with a
  600 ms debounce, and quarantine of invalid documents.
- Builder IPC (`builderEnter/Exit/Toggle/Status`, `snowmen`, `snowmanCreate`,
  `snowmanAddBall`, `deleteSnowman`, `clearSnowmen`) and panel controls.

### Fixed

- IPC string arguments are coerced at the service boundary so persisted
  coordinates stay numeric and pass validation.
- `snowmenChanged` renamed to avoid QML's generated property-change signal.

### Tests

- 75/75 Node tests passing; live verified: enter/exit, create, stack, persist,
  reload after restart, delete, and quarantine of corrupt state.

## [0.4.0] — 2026-11-21 — Phase 4: Window Movement Physics

### Added

- Velocity, speed and acceleration derived from geometry deltas with a real dt.
- Window translation now preserves the bank and moves it with the surface;
  slow movement slides snow toward the trailing edge, fast movement sheds a
  bounded number of flakes with inherited window momentum.
- Detached-particle pool (128 per monitor) with gravity, landing detection and
  re-accumulation; resize resamples the bank and never causes detachment.
- `js/FlakeShape.js`: procedural six-arm snowflake crystals with dendrites,
  replacing plain circles; renderer draws both falling and detached flakes.
- 10 new movement/shape tests; 65/65 passing.

### Fixed

- Detachment now scans inward from the trailing edge instead of only checking
  the outermost segments.
- Bank resampling conserves total snow mass when a window changes width.

## [0.3.0] — 2026-11-21 — Phase 3: Window Geometry and Snow Accumulation

### Added

- Hyprland geometry adapter in `Service.qml`: event-driven `refreshToplevels()`
  with a bounded 100/500 ms poll, monitor/window snapshots with movement
  deltas, active-workspace filtering and logical/physical scale conversion.
- `js/WindowGeometry.js`, `js/SnowBank.js`, `js/Collision.js`: stable geometry
  model, bounded Float32 height maps, and surface landing tests.
- Accumulation into monitor-bottom and window-top banks, with sliding, peak
  redistribution and slow erosion; banks are recreated on resize and dropped
  for removed windows.
- `qml/SnowBankRenderer.qml`: revision-gated bank painting, separate from the
  falling-flake canvas.
- `snowglobe geometry`, `snowglobe probe` and `snowglobe syncGeometry` diagnostics;
  surface and bank counts in status and metrics.

### Fixed

- QML `QVariantList` fields are array-like but not JS arrays; geometry fields
  now use length/index access instead of `Array.isArray`.
- Accumulation-setting changes now propagate even when window geometry is unchanged.
- Fractional bank deposits no longer vanish through integer truncation.

### Tests

- 55/55 Node tests passing (22 new geometry/accumulation tests).
- Live: 4 → 1 tracked windows after workspace filtering, 2 banks (ground +
  active window), bank revision and landings increasing, 60 steps/60 paints/s.

## [0.2.0] — 2026-11-21 — Phase 2: Snowfall Engine

### Added

- Deterministic per-monitor simulation (`js/MathUtils.js`, `js/ParticleSystem.js`,
  `js/Simulation.js`) with a seeded PRNG, fixed 60 Hz step, bounded backlog,
  gravity with air resistance, wind gusts and per-flake sway.
- Batched Canvas renderer (`qml/SnowRenderer.qml`, `qml/MonitorScene.qml`) with
  no QML objects per particle; one paint pass per monitor.
- Quality/density-driven particle limits, per-monitor simulation lifecycle on
  screen hotplug, and in-situ metrics via `omarchy-shell snowglobe metrics`.
- `snowglobe clear` IPC and zeroed metrics while the surface is unmapped.
- 17 new physics unit tests; total 33 tests passing.

### Measured

- Balanced: 300 flakes, 60 steps/s, 60 paints/s, ~0.4 ms step + ~0.4 ms paint.
- High with density 3: 1200 flakes, ~1.5 ms step + ~1.1 ms paint.
- See `docs/PERFORMANCE.md` for full results and methodology.

## [0.1.0] — 2026-11-21 — Phase 1: Plugin Foundation

### Added

- Manifest with `service` and `bar-widget` kinds, settings schema and defaults.
- `Service.qml`: mode machine (`disabled`/`paused`/`passive`), one click-through
  layer surface per monitor, state-document loading, diagnostics and pause/resume IPC.
- `BarWidget.qml`: native bar glyph, left-click toggle, right-click panel, settings
  push to the service, and `snowglobe.bar` IPC including bounded `configure`.
- `Panel.qml`: native `qs.Ui` settings panel with overview, behavior, diagnostics
  and a two-step settings reset.
- `qml/OverlaySurface.qml`: transparent `PanelWindow` with an empty input region.
- `js/Constants.js`, `js/Settings.js`, `js/State.js`: single sources of limits,
  preference validation/migration and versioned state validation.
- `i18n/en.json` translation catalog; all plugin-owned text is `Text.PlainText`.
- Node unit tests for settings, state and constants.
- `scripts/validate.sh`, `install.sh`, `uninstall.sh`, `package.sh`.
- Phase 0 research, architecture, decisions, compatibility and risk documentation.

### Notes

- No snowfall, accumulation or snowman construction is implemented yet.
- No performance measurements have been taken; no targets are claimed as met.
