# Reference video: behaviour specification

Source: `hero-3.mp4` (1920×1246, 60 fps, 40.8 s), a macOS screen recording of the
reference app **KoiArt**. Snowglobe's goal is to behave like this on Omarchy.
Frames are in `docs/reference/`. Everything below was read from those frames;
items marked **(unverified)** could not be determined from the sampling used and
must be confirmed before the step that depends on them.

## 1. Observed behaviour (with timestamps)

| # | Time | What happens |
|---|------|--------------|
| 1 | 0:00–0:02 | Light snowfall of soft round flakes of mixed size. A **thin wavy white line** runs along the whole bottom edge of the screen, and a **thin white cap** sits on top of the Dock. |
| 2 | 0:02 | With **no mode switch**, the pointer drags along the bottom snow; a snowball appears under the pointer and grows while it moves. |
| 3 | 0:02.6–0:04 | The ball is lifted off the ground by the pointer and carried to the Dock, where it comes to rest **on the Dock's snow cap**. |
| 4 | 0:04–0:05.5 | A second ball is made the same way and **stacks on top** of the first (smaller). |
| 5 | 0:06.5–0:07.5 | The stack is a **snowman**: small face and red scarf are visible. Finer details (buttons, arms, hat) **(unverified)**. |
| 6 | 0:08.5–0:10 | The pointer grabs the snowman; it is flung up and across the scene and is **gone by 0:10**. Whether it is thrown off-screen or removed **(unverified)**. |
| 7 | 0:10–0:24 | A Finder window opens and is moved/resized. A thin white cap sits on the window's top edge and **follows the window**. |
| 8 | 0:24–0:27 | Menu-bar icon (❄) opens a menu (see §2). "Heavy snow" is ticked; the pointer picks **Send snowplough**. |
| 9 | 0:29–0:40 | **Snowplough** (see §3) crosses the screen along the bottom edge, right to left, and leaves. Afterwards small mounds regrow on the ground line. |
| 10 | 0:34–0:39 | Balls dropped on the Dock cap **survive** the plough passing below. |

## 2. Menu (exact items, in order)

`Snow` · `Heavy snow ✓` · `Send snowplough` · `Rain` · `Sakura` · `Leaves` ·
`Fireflies` · `Starfall` · `Off` — separator — `Open KoiArt…` — separator — `Quit KoiArt ⌘Q`.

Each item has a small coloured icon (snow: blue, heavy snow: darker blue, plough:
orange, rain: blue cloud, sakura: pink flower, leaves: orange leaf, fireflies:
yellow, starfall: purple star). One mode is ticked at a time; "Send snowplough"
is an action, not a mode. Only Snow, Heavy snow and the plough are demonstrated;
the **look of Rain, Sakura, Leaves, Fireflies and Starfall is not in the video**
and will be designed (the user approved including them).

## 3. Snowplough (observed)

- Small cartoon vehicle: **yellow** body, **light-blue** cab window, **four
  wheels** with light hubs, a white blade at the front.
- Enters from the **right** edge, drives **left** along the bottom edge.
- A **white wedge of snow grows in front of the blade** as it pushes; a small ball
  can ride inside the wedge.
- It passes in front of the Dock icons, then leaves off the left edge, taking the
  pile with it.

## 4. Gap analysis (Snowglobe 1.1.2 vs. the video)

| Area | Video | Snowglobe 1.1.2 | Planned step |
|------|-------|-----------------|--------------|
| Ground snow | thin wavy line, a few px | height-map bank up to `GROUND_MAX_DEPTH` = 56 px | 2 |
| Window / panel caps | thin line, a few px | up to `WINDOW_MAX_DEPTH` = 26 px slab | 2 |
| Flakes | soft round points | soft points plus six-arm crystals for large flakes | 2 |
| Heavy snow | selectable denser mode | only a `density` number, no UI | 2, 6 |
| Making a ball | drag in the snow, **no mode** | modal full-screen builder (grabs all input and the keyboard) | 3 |
| Stack on Dock/panel | yes | stacks on window tops and ground | 3, 4 |
| Snowman face | scarf/face appear automatically | decorations placed by hand in a tool | 4 |
| Grab and throw | yes | Move tool only, no throw | 4 |
| Plough look | yellow, white wedge, ball rides in it | small orange vehicle, no wedge | 5 |
| Menu | 9-item mode menu | left-click toggles, right-click opens settings | 6 |
| Other modes | Rain, Sakura, Leaves, Fireflies, Starfall | none | 6 |

## 4a. Stability findings fixed in Step 1 (1.1.2)

See `CHANGELOG.md`: `plowEnabled` dropped on every settings write, manifest drift,
unconditional repaint of idle full-screen canvases, stale duplicate constants,
**scooped snow destroyed when a ball is abandoned**, and a QML test that failed
about half the time because it froze the roller it was testing.

## 5. Constraints this spec cannot resolve

- The video is macOS: the Dock, menu bar and Finder do not exist on Omarchy. The
  equivalents are Hyprland windows and the Omarchy bar/panel. "Snow on the Dock"
  becomes snow on any window top and on the bar.
- Direct grabbing (row 2 above) requires the overlay to accept pointer input
  **only** over snow lines, balls and snowmen, and stay click-through elsewhere.
  That relies on Wayland input regions in Quickshell and must be tested on real
  hardware; it cannot be verified headlessly.
