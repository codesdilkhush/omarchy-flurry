# Snowglobe — Architectural Decisions

Format: context → decision → consequences → status. "Source-verified" means the
mechanism was confirmed by reading Omarchy/Quickshell source; "runtime-verified"
means it was observed on a running desktop. Nothing is runtime-verified yet.

---

## ADR-001 — Snowglobe is an in-shell plugin, not an application

**Context.** Omarchy runs one long-lived Quickshell process hosting bar, panels,
overlays and services as plugins. `shell-dev.md`: "do not start additional
standalone Quickshell instances for individual components."
**Decision.** Ship `kinds: ["service", "bar-widget"]`: the service owns the
simulation and creates the per-monitor layer surfaces; the bar widget owns the
UI and the panel.
**Consequences.** No daemon, no autostart entry, no second process. Lifecycle is
the host's lifecycle; a shell restart reloads everything from disk. We inherit
the host's privilege and must not abuse it.
**Status.** Source-verified (`docs/omarchy-shell.md`, `shell/plugins/README.md`).

---

## ADR-002 — No Rust, no C++

**Context.** The brief permits Rust only after a *verified* limitation. Abyss
uses Rust because it renders a game; omasnow uses Python for geometry.
**Decision.** Nothing in this design requires either. Geometry comes from the
`Hyprland` API or a `Quickshell.Io.Socket` client; rendering uses
`QtQuick.Particles`, `Canvas` and `Image`; physics is plain JS over typed arrays.
**Consequences.** Single language surface, no build step, no binary to package,
plugin install remains `omarchy plugin add`. If a measured frame-budget failure
later requires a QSG node, that becomes a new ADR with numbers attached.
**Status.** Decided; revisit only with measurements.

---

## ADR-003 — Geometry is polled adaptively, not event-driven

**Context.** `HyprlandToplevel` has no geometry properties or signals;
`lastIpcObject` updates only on `Hyprland.refreshToplevels()`; the only
move-related event (`movewindowv2`) is used solely to re-parent workspaces; and
Hyprland emits **no resize event at all**. omasnow's Python helper polls at
10 Hz for exactly this reason.
**Decision.** One shared geometry driver for the whole plugin: ≈100 ms while
geometry is changing, ≈500 ms idle, stopped when disabled. Read
`lastIpcObject.at/size`, diff, emit only changes.
**Consequences.** Geometry can lag a fast drag by up to one interval. Mitigated
by (a) carrying a window's bank with the window rather than recomputing it,
(b) defaulting to the `Bottom` layer where the compositor occludes snowfall
without our help, and (c) tuning the interval from `poc/geometry` measurements.
**Status.** Source-verified; interval **[verify]**.

---

## ADR-004 — Two render paths over one simulation

**Context.** Measured evidence in the ecosystem: omarchy-pane reports ~1700
`ItemParticle`s costing ~80 % of a core versus a batched `ImageParticle`; a
fullscreen `Canvas` re-uploads a large texture per repaint; omasnow instead uses
one narrow `Canvas` per bank that repaints only when snow lands.
**Decision.** Falling snow is `QtQuick.Particles`. Accumulation is one narrow
`Canvas` per surface, repainted only on change. Detached clumps and snowmen are
a small pooled set of items.
**Consequences.** No per-particle QML objects; accumulation cost scales with
surface width, not with time; detached clumps are the only per-item cost and
they are hard-capped.
**Status.** Approach source/ecosystem-verified; our own frame budget **[verify]**
in Phase 2.

---

## ADR-005 — Click-through is the default state, capture is an explicit state

**Context.** A transparent layer surface captures input unless a mask makes it
otherwise. Quickshell's `ProxyWindowBase::onPolished()` sets
`Qt::WindowTransparentForInput` when the mask region is empty; omarchy-pane
ships `mask: Region {}` for exactly this. A contradicting public issue report
exists.
**Decision.** One state machine with four states (Disabled, Paused, Passive,
Builder). Passive = `mask: Region {}` + `keyboardFocus: None`. Builder =
full-surface region + `Exclusive` focus, with `Escape` and a watchdog both
returning to Passive. The mask is restored *first* in every teardown path.
**Consequences.** No accidental input interception; a stuck overlay is
recoverable without restarting the shell.
**Status.** Source-verified; **[verify] with `poc/overlay`** — Phase 1 gate.

---

## ADR-006 — Accumulation as a per-surface height map, not particle piles

**Context.** Storing individual landed flakes grows without bound; a
height map is O(width) and constant after allocation.
**Decision.** `Uint8Array` heights per 2 px segment, plus a cached
`peak()`/`revision` for the renderer. Deposition stamps a radial footprint;
sliding is a bounded relaxation pass. Both conserve total snow exactly
(`poc/physics` tests).
**Consequences.** Sub-2 px detail is lost — invisible at viewing distance, and
cheaper than the alternative. Sliding is approximate but deterministic and
order-stable.
**Status.** Spike-verified (16/16 tests).

---

## ADR-007 — Fixed timestep with a clamped accumulator

**Context.** Frame deltas vary from 4 ms to multi-second after suspend/resume;
variable-step integration makes behaviour frame-rate dependent and makes
movement physics untestable.
**Decision.** Fixed 1/60 s steps, max 5 steps per frame, backlog discarded on
clamp. Proven identical results for 60 FPS and jittery pacing.
**Consequences.** A resumed shell never fast-forwards; long stalls drop time
rather than spiral.
**Status.** Spike-verified.

---

## ADR-008 — Preferences in `shell.json`, decorations in XDG state

**Context.** Omarchy keeps plugin settings inline in `shell.json`, written via
`shell.updateEntryInline`, with **no merge layer** and no `config:` sub-object.
Snowmen are data, not preferences, and would bloat that file.
**Decision.** Preferences → the plugin's `shell.json` entry, written only
through the host API, read back via a watched `FileView`. Snowmen, diagnostics
and the last-known-good backup → `$XDG_STATE_HOME/snowglobe/state.json`,
written atomically with temp-file + rename.
**Consequences.** `omarchy bar set` and Settings › Plugins stay authoritative;
Snowglobe never rewrites the shell's config file wholesale. Two stores means two
validators, both tested.
**Status.** Contract source-verified.

---

## ADR-009 — Monitor-local logical coordinates inside, global only at the edge

**Context.** Negative monitor origins, mixed DPI, rotation and hotplug make
"just use screen coordinates" wrong in several ways at once.
**Decision.** `js/Geometry.js` is the only place that touches monitor origins;
the simulation and renderer work in monitor-local logical px; physical px appear
only for assets. Rotation swaps axes when `transform % 2`. DPI always comes from
`ShellScreen.devicePixelRatio` (there is no `scale` on `ShellScreen`).
**Consequences.** Every test can run against small synthetic monitor layouts,
including negative coordinates.
**Status.** Source-verified types; **[verify]** values on real hardware.

---

## ADR-010 — Default to the Bottom layer, offer Above as a setting

**Context.** Snow above windows is the attractive look, but it is only correct
if geometry is current; snow below windows is occluded by the compositor for
free (omasnow's deliberate choice; KoiArt ships both modes).
**Decision.** `layer: "behind" | "above"`, default `behind`.
**Consequences.** Default configuration looks right even when geometry lags;
users who want snow over windows accept the polling trade-off.
**Status.** Decided; visual quality **[verify]** in Phase 2.

---

## ADR-011 — No `keepLoaded`

**Context.** `keepLoaded: true` avoids remapping but keeps an instance running
old code across hot-reload.
**Decision.** Do not set it. Rebuild scenes on demand.
**Consequences.** Small mount cost per enable/summon; no stale-code hazard
during development or after updates.
**Status.** Decided.

---

## ADR-012 — Do not ship a custom installer

**Context.** The brief's structure proposes `scripts/install.sh` and
`uninstall.sh`. Omarchy already installs plugins as git checkouts into
`~/.config/omarchy/plugins/<id>/` and removes them with `omarchy plugin remove`.
**Decision.** `scripts/` keeps only `validate.sh` (manifest + static checks) and
`package.sh` (release archive). Installation is documented official commands.
**Consequences.** One installation path, no drift from the host's expectations,
no script that can damage an existing checkout. It also sidesteps the validator's
symlink ban, which a dev-mode installer would otherwise violate.
**Status.** Decided.

---

## ADR-013 — Tests are Node-based for pure logic, manual for the desktop

**Context.** No Python test frameworks are allowed; Qt Test cannot run on a
machine without Qt; omasnow already ships `.cjs` tests for its engine.
**Decision.** All deterministic modules (clock, pool, simulation, surfaces,
geometry, snowman rules, settings) are tested with `node --test`, a development
dependency only — the plugin itself never runs Node. QML and desktop behaviour
are verified with `qmllint`, `omarchy plugin validate`, the two PoC probes and a
documented manual matrix.
**Consequences.** Real automated coverage of everything that can be headless;
desktop behaviour is honestly reported as manual.
**Status.** In use already (`poc/physics`, 16 tests).

---

## ADR-014 — Bound every resource at construction, not at use

**Context.** Unbounded arrays are how desktop toys become memory leaks; the
brief forbids unbounded particle generation and accumulation data.
**Decision.** Pools are preallocated and never grow; surfaces are capped;
snowmen are capped; tracked windows are capped; state file size is capped and
validated on read; log output is rate-limited.
**Consequences.** Worst-case memory is computable from settings alone, and
testable.
**Status.** Decided; enforced in Phase 2/3 tests.

---

## ADR-015 — PoC code never ships

**Context.** Two probes were needed to settle input and geometry questions.
**Decision.** `poc/` is excluded from the release archive and deleted at Phase 6;
nothing in `poc/` may be imported by plugin code.
**Consequences.** Production modules cannot accidentally depend on an experiment.
**Status.** Decided.
