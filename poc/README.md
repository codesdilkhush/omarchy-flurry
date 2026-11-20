# Phase 0 proof of concept

These files exist to answer the questions that the documentation and the
Quickshell/Omarchy source could not settle by reading alone. They are **not**
part of Snowglobe's architecture and are never installed into the user's shell.
They run as throwaway standalone Quickshell instances:

```bash
bash poc/env-check.sh                  # read-only: versions, monitors, GPU, shell.json
quickshell -p poc/overlay/InputMaskProbe.qml
quickshell -p poc/geometry/GeometryProbe.qml
```

Each prints `[poc…]` lines to the console. Run them one at a time, on the real
Omarchy machine, and copy the output into the Phase 0 verification table in
`docs/RESEARCH.md`.

## What has and has not been run

| PoC | Written | Executed | Why |
|-----|---------|----------|-----|
| `physics/sim.mjs` + `sim.test.mjs` | yes | **yes** — `node --test poc/physics/`, 16/16 pass | Pure JavaScript, no desktop required |
| `env-check.sh` | yes | **yes** — `bash -n` syntax check; runs end to end here | Not a result: on a machine without Omarchy it correctly reports every tool `MISSING` |
| `overlay/InputMaskProbe.qml` | yes | **no** | Needs Hyprland + Quickshell; the Phase 0 machine has neither |
| `geometry/GeometryProbe.qml` | yes | **no** | Needs a Hyprland session with movable windows |

Nothing in this directory may be cited as evidence of runtime behaviour that
was not actually observed. The QML probes are hypotheses with an instrument
attached, not results.

## `physics/` — data-representation spike

Proves, in isolation, the two decisions `ARCHITECTURE.md` depends on:

1. a fixed-timestep accumulator keeps results identical regardless of frame
   pacing, and clamps a 4-second suspend instead of fast-forwarding it;
2. accumulation as a per-surface `Uint8Array` height map is bounded in memory
   and exactly conserves snow when it slides.

Run it with Node (development tooling only — the shipped plugin never contains
a Node runtime):

```bash
node --test poc/physics/
```

The benchmark inside the test suite reports µs per simulation step for the
proposed particle and segment counts. That number describes whatever machine
ran it; it is not a claim about the user's desktop.

## `overlay/` — input pass-through and builder capture

Question: does the passive overlay really let every click through, and can a
mask switch turn capture on and off at runtime without remapping the surface?

Procedure:

1. Start the probe. It opens a transparent fullscreen surface on every monitor
   and starts in **passive** mode (`mask: Region {}`).
2. Click, drag, scroll, and type into a normal application underneath. All of it
   must behave as if the probe were not running.
3. `quickshell ipc call snowglobe-poc builder` (or the keybinding the probe
   documents). The overlay becomes visible and tints the screen; clicks now log
   `[poc] click on <screen> at x,y` and must not reach the app underneath.
4. Press `Escape`. Clicks must pass through again.

Record: whether clicks passed through in step 2, whether capture worked in
step 3, whether `Escape` was received, and whether any frame flicker appeared
when the mask changed.

## `geometry/` — window geometry freshness

Question: how stale is `HyprlandToplevel.lastIpcObject` during a window drag,
what does a bounded `refreshToplevels()` poll cost, and which events does
Hyprland actually emit while dragging or resizing?

Procedure:

1. Start the probe and leave it running for a minute with nothing else
   happening — this is the idle baseline (`[poc-geom] polls=… fastPoll=false`).
2. Drag a window slowly, then quickly, then diagonally. Resize one from a
   corner. Snap one to an edge. Switch workspaces. Toggle a window fullscreen.
3. Read the log: each change line shows the previous and new `at`/`size`, and
   the 2-second line shows the event histogram and whether the probe is on the
   fast poll.

Record:

- whether `at`/`size` changed at all during a drag, and how many polls behind
  the pointer the reported position was;
- the event names in the histogram — in particular whether anything fires per
  drag frame, and whether resizing produces any event at all;
- CPU cost of the fast poll (`top`/`htop`, probe process only).

That last question is the one that decides whether Phase 3 keeps a poll at all,
and at what rate.
