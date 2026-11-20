# Snowglobe — Technical Risk Register

Severity: **S1** = can break the desktop or the feature's core promise;
**S2** = feature degrades or needs rework; **S3** = cosmetic or maintenance.
Status: **verified** (source read), **spike** (executed on this machine),
**blocked** (needs the Omarchy machine), **open** (not yet investigated).

Every S1 must have a fallback that keeps the desktop usable.

---

### R1 — Passive-overlay click-through may not work on the user's build

- **Assumption.** A transparent fullscreen layer surface with `mask: Region {}`
  lets every click, drag and scroll through to the window beneath.
- **Mechanism.** `ProxyWindowBase::onPolished()` sets
  `Qt::WindowTransparentForInput` when the mask region is empty; omarchy-pane
  ships this pattern.
- **Verified.** Source-verified in Quickshell master; a contradicting report
  exists from another project. **Not** runtime-verified.
- **Could fail.** Older Quickshell without the polish path; a compositor that
  gives layer surfaces an implicit default input region; mask updates not
  applied without a remap.
- **Fallback.** (a) Re-map the surface on mask change instead of mutating it;
  (b) restrict the surface to the bottom strip of each monitor (where snow
  accumulates) and use a separate, short-lived fullscreen surface only in
  builder mode; (c) last resort — ship with `layer: Bottom` and no interactive
  overlay, and document builder mode as unavailable.
- **Severity.** S1. **Gate.** Phase 1 acceptance; experiment
  `poc/overlay/InputMaskProbe.qml`.

---

### R2 — Window geometry is inevitably stale during a drag

- **Assumption.** A bounded poll is good enough to make snow appear attached to
  moving windows.
- **Mechanism.** `Hyprland.refreshToplevels()` at ~100 ms while moving; the bank
  travels with the window so attachment does not depend on freshness.
- **Verified.** Source-verified that no event exists to do better; omasnow's
  independent 10 Hz poll confirms it. Lag magnitude **blocked**.
- **Could fail.** A drag faster than the poll makes snow visibly trail the
  window; `j/clients` cost at 10 Hz is higher than expected on weak hardware.
- **Fallback.** Raise the rate only while a drag is detected; interpolate window
  position between snapshots for rendering; default to `layer: Bottom` where the
  compositor occludes the discrepancy; if all else fails, freeze bank motion
  during drags and only detach snow on drag *end*.
- **Severity.** S1 for the headline feature. **Gate.** Phase 3/4; experiment
  `poc/geometry/GeometryProbe.qml`.

---

### R3 — Hyprland emits no resize event

- **Assumption.** Resizing is handled by diffing size between polls.
- **Mechanism.** Same poll; on width change the bank is re-segmented on the
  overlap and the shed snow becomes particles.
- **Verified.** Source-verified (no resize event in the handled set).
- **Could fail.** Resize looks like a teleport for one interval; repeated
  re-segmentation could thrash allocation.
- **Fallback.** Debounce re-segmentation (only after the size is stable for one
  step) and reuse the existing array when the segment count is unchanged.
- **Severity.** S2.

---

### R4 — Frame budget not met on integrated GPUs

- **Assumption.** `QtQuick.Particles` + narrow `Canvas` banks + a small entity
  pool fit in 6 ms per frame at 2 monitors.
- **Mechanism.** ADR-004's split renderer, bounded counts, adaptive quality.
- **Verified.** Ecosystem evidence only (pane's ~80 % core figure is for the
  *bad* approach it rejected). **Blocked** — needs measurement.
- **Could fail.** Many window banks force many canvas textures; particle system
  per monitor multiplies cost; a 4K monitor at 1.5 scale doubles pixels.
- **Fallback.** Reduce default particle count; cap bank count (merge adjacent
  windows into one surface row); drop to `Low` profile automatically when frame
  time exceeds budget for N frames; pause window accumulation on high-DPI.
- **Severity.** S1 (the brief makes responsiveness non-negotiable). **Gate.**
  Phase 2 measurement; `docs/PERFORMANCE.md` must record real numbers.

---

### R5 — Settings writes could damage `shell.json`

- **Assumption.** Handing a validated settings object to
  `shell.updateEntryInline()` is safe.
- **Mechanism.** The host owns file IO and writes atomically; Snowglobe never
  rewrites the file itself and never sends unknown keys.
- **Verified.** Contract source-verified; host write path read at
  `shell.qml:1120`.
- **Could fail.** A third-party facade may not expose `updateEntryInline`
  (the docs describe capability-scoped facades), leaving settings read-only.
- **Fallback.** Detect a missing method and fall back to read-only settings with
  a clear message in the panel; never attempt a direct file write. (Also the
  reason state lives in our own XDG file, which we do control.)
- **Severity.** S1 (data loss risk is unacceptable). **Gate.** Phase 1 manual
  check on a real shell.

---

### R6 — Monitor/DPI/coordinate handling is wrong on real hardware

- **Assumption.** `local = global − monitor.x/y`, DPI from `devicePixelRatio`,
  axis swap on odd `transform` is sufficient.
- **Mechanism.** `js/Geometry.js` as the single conversion site, with unit tests
  including negative origins and mixed DPI.
- **Verified.** Types source-verified; values **blocked**.
- **Could fail.** Snow offset by a bar's reserved area; half-scale snow on a
  fractional-DPI monitor; wrong axis on a rotated panel.
- **Fallback.** Expose a diagnostics view showing computed versus `hyprctl`
  geometry; clamp to monitor bounds so an offset can never draw outside the
  surface.
- **Severity.** S2 (S1 if it renders snow on the wrong monitor).

---

### R7 — Layer surfaces cannot sample the framebuffer

- **Assumption.** No refraction, blur-behind, or "glass" sampling is possible.
- **Mechanism.** Everything is painted; any depth cue is an authored gradient.
- **Verified.** Source-verified via omarchy-pane's explicit note.
- **Could fail.** Reviewers expect KoiArt's look. They will get painted snow.
- **Fallback.** Accept and document; lean on shape, opacity and motion rather
  than sampled effects.
- **Severity.** S3 (design constraint, known up front).

---

### R8 — Snowman interaction conflicts with normal desktop use

- **Assumption.** An explicit builder mode is enough of a boundary that users
  never get a "dead screen".
- **Mechanism.** Four-state machine, `Escape`, watchdog, mask restored first.
- **Verified.** Design only.
- **Could fail.** Builder mode entered by a stray shortcut; escape swallowed by
  another client that grabbed keyboard focus; overlay left mapped after a shell
  error.
- **Fallback.** Builder mode requires an explicit action (panel button or
  shortcut) and shows a visible banner; a 30 s no-input watchdog exits; the bar
  widget always shows a one-click "Exit builder" and "Disable" control.
- **Severity.** S1. **Gate.** Phase 5 manual matrix.

---

### R9 — Third-party plugin privilege

- **Assumption.** Snowglobe runs with full user authority inside the shell.
- **Mechanism.** No network, no subprocess, no writes outside its state file and
  the host settings API; all persisted input validated.
- **Verified.** Documented in `shell-dev.md` ("not a same-process QML sandbox").
- **Could fail.** A malicious state file (crafted JSON) could try to expand
  arrays or inject properties.
- **Fallback.** Strict schema validation with size caps; quarantine corrupt
  state rather than parse it loosely.
- **Severity.** S2.

---

### R10 — `Style.duration()` returns 0 with animations disabled

- **Assumption.** Animation timing always comes from the host token.
- **Mechanism.** All durations go through `Style.duration()`.
- **Verified.** Documented in `omarchy-shell.md`.
- **Could fail.** A divide-by-duration or a `NumberAnimation` with 0 duration
  used as a timer breaks logic.
- **Fallback.** Never use animation completion as a state transition; use
  explicit timers or immediate state changes when duration is 0.
- **Severity.** S3.

---

### R11 — Hotplug leaves stale surfaces

- **Assumption.** Rebuilding scenes on `screensChanged` is sufficient.
- **Mechanism.** Drop scenes for missing screens; never reuse a dangling
  `ShellScreen`; release that monitor's surfaces and pools.
- **Verified.** Dangling behaviour documented in `qmlscreen.hpp`.
- **Could fail.** A surface mapped to a removed output keeps an input region.
- **Fallback.** Transition to Passive (empty mask) for all surfaces, then
  rebuild; the watchdog also covers this.
- **Severity.** S2.

---

### R12 — Persistence growth and corruption

- **Assumption.** Snowmen are few and the state file stays small.
- **Mechanism.** Hard cap on snowmen; atomic write; size-capped read with
  backup-and-defaults on corruption.
- **Verified.** Design only.
- **Could fail.** A user script writes junk; the file grows across versions.
- **Fallback.** Schema `version` field with migration; quarantine
  `state.corrupt.<ts>.json`; never overwrite silently.
- **Severity.** S2.

---

### R13 — Plugin hot-reload with a mapped overlay

- **Assumption.** Not using `keepLoaded` means a reload destroys the surface
  cleanly.
- **Mechanism.** Rebuild scenes on load; unmap on destruction.
- **Verified.** Design only.
- **Could fail.** A reload during builder mode leaves an old surface with a
  full mask and no code to dismiss it.
- **Fallback.** Builder mode is *not* persisted across reloads; on load, always
  start Passive. Document that a reload during builder exits builder mode.
- **Severity.** S1 (same class as R8). **Gate.** Phase 1 reload test.

---

### R14 — Battery and fullscreen behaviour regresses

- **Assumption.** Pausing means unmapping, and battery detection is available.
- **Mechanism.** Unmap on fullscreen (socket2 `fullscreen>>`) and on battery
  (Quickshell UPower service, if present).
- **Verified.** Fullscreen pattern verified in omarchy-pane; UPower availability
  on the installed build **blocked**.
- **Could fail.** UPower not present → battery pause unavailable.
- **Fallback.** Make battery pause optional and hide the setting when the
  service is absent; never depend on it for correctness.
- **Severity.** S2.

---

### R15 — Testing gap: no desktop in CI

- **Assumption.** Pure-JS tests plus manual matrix is acceptable coverage.
- **Mechanism.** `node --test` for logic; `scripts/validate.sh` +
  `qmllint` + `omarchy plugin validate` for integration.
- **Verified.** Node suite runs here (16/16).
- **Could fail.** QML-level regressions (a typo in a binding) pass CI.
- **Fallback.** `qmllint` is mandatory in the release checklist; the manual
  matrix in `docs/TEST_PLAN.md` is executed per phase and recorded honestly.
- **Severity.** S2.

---

### R16 — KoiArt-derived expectations

- **Assumption.** Users comparing to KoiArt will accept a subset
  (snow + accumulation + window physics + snowmen + persistence) without Santa,
  trains, trees, or the Yeti.
- **Mechanism.** Document the scope explicitly in the README.
- **Verified.** n/a (product risk).
- **Could fail.** Scope creep requests.
- **Fallback.** Keep subsystems extensible (ADR-015 of the brief's future
  section) but ship MVP first.
- **Severity.** S3.

---

## Summary

| Severity | Count | Must be closed before |
|---|---|---|
| S1 | 6 (R1, R2, R4, R5, R8, R13) | Phase 1 (R1, R5, R13), Phase 2 (R4), Phase 3 (R2), Phase 5 (R8) |
| S2 | 7 | before release |
| S3 | 3 | documented at release |

No S1 risk is closed yet. Two are addressable with the PoC probes already
written; the rest need the measurement phases they belong to.
