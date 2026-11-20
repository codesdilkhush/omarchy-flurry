# Snowglobe

An Omarchy desktop plugin: interactive, window-aware snowfall that settles on
window tops and the ground and accumulates into drivable snow, plus a
persistent Snowman Builder.

Native Omarchy plugin — QML/JavaScript + Quickshell (Qt Quick) + Hyprland IPC.
No Python, no Electron, no browser rendering, no helper daemon, no second
Quickshell instance.

## Status: Phase 0 — research and feasibility only

There is **no plugin code yet**. This repository currently contains the Phase 0
deliverables: the research, the architecture, the decision records, and the
proof-of-concept probes. Nothing here is installed by Omarchy.

| Area | State |
|---|---|
| Feasibility research (source-verified) | done |
| Architecture, decisions, risks | done |
| Physics/timing spike (`poc/physics`) | **executed** — `node --test poc/physics/`, 16/16 pass |
| Input pass-through probe (`poc/overlay`) | **written, not executed** — needs a live Hyprland session |
| Geometry staleness probe (`poc/geometry`) | **written, not executed** — needs a live Hyprland session |
| Installed-system compatibility (Omarchy/Quickshell/Qt/Hyprland versions, monitors, GPU) | **blocked** — see `docs/COMPATIBILITY.md` §3 |

No performance number in these documents is a measurement of a real desktop
session. The only measured figure is the JavaScript simulation step in
`poc/physics`, on the machine that ran it.

## Documents

| File | Contents |
|---|---|
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | What Omarchy/Quickshell/Hyprland actually allow, with `file:line` citations; what remains unverified and how to verify it |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System shape, subsystem interfaces, coordinate rules, proposed file tree, lifecycle, performance budgets |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADR-001…ADR-015 with status |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | Verified vs unverified matrix, coordinate/scaling quirks, hard requirements |
| [`docs/RISKS.md`](docs/RISKS.md) | Risk register R1–R16 with trigger, detection and fallback |
| [`poc/README.md`](poc/README.md) | Exactly what was and was not run, and the manual procedures |

## Running the Phase 0 probes

The physics spike needs only Node (development tooling; the plugin itself ships
no Node runtime):

```bash
node --test poc/physics/
```

The environment probe is read-only and installs nothing:

```bash
bash poc/env-check.sh
```

The two QML probes open a throwaway fullscreen surface in your current session;
run them one at a time, in a Hyprland session, and read their console output:

```bash
quickshell -p poc/overlay/InputMaskProbe.qml
quickshell -p poc/geometry/GeometryProbe.qml
```

## Requirements (for the eventual plugin)

- Omarchy with the `omarchy-shell` (Quickshell) desktop
- Hyprland
- Qt 6 / Quickshell as shipped by Omarchy

No additional runtime dependencies are planned.

## Installation

Not available yet. When Phase 6 lands, installation will be the official
Omarchy commands and nothing else:

```bash
omarchy plugin add <this-repo-url>
omarchy plugin remove snowglobe
```

There will be no custom `install.sh`.

`poc/` is never installed and is removed before release.
