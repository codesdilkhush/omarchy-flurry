# Flurry

Weather for your [Omarchy](https://omarchy.org) Quattro desktop.

Snow falls over your windows and piles up on their top edges. Fling a window
and the snow flies off it. Grow Christmas trees and hang baubles, lights and
candy canes on them, roll snowmen and set them on your windows, and send them
to friends on a little train. Santa rides by now and then, and a Yeti may come
for your snowman.

![Snow piling up on windows](docs/snow.png)
![Trees, snowmen, Santa, the Yeti and the train](docs/decorations.png)

## Install

```bash
omarchy plugin add https://github.com/itscallssh/omarchy-flurry.git --enable
```

The snowflake lands on the right of the bar. Requires Omarchy 4 (Quattro) or
later. Gifts between friends also need `curl` and `wl-clipboard`, which
Omarchy ships.

## Use it

| | |
|---|---|
| Click the bar icon | Effects, amount, decorate, friends |
| Right-click it | Weather on or off |
| Scroll on it | Next or previous effect |
| Drag a decoration | Move it; drop a snowman on a window's top edge and it rides that window |
| Right-click a tree or snowman | Send it to a friend, or remove it |
| Click a gift or a letter | Open it |
| Click Santa | He drops a present |
| Click the Yeti | He runs off without your snowman |

### Six kinds of weather

- **Snow** settles on window tops and the ground. Drag a window and it slides off; close one and it falls.
- **Leaves** pile up and scatter when you brush the pointer through them.
- **Starfall**: shooting stars that burst into sparks on your windows.
- **Rain** splashes where it lands, with lightning now and then.
- **Sakura** petals drift down and rest on your windows for a while.
- **Fireflies** drift about and gather where the pointer rests.

### Decorate

Pick **Decorate** in the menu (or `flurry decorate`). A toolbar appears: plant
up to three trees, roll snowmen, then click a tree with the bauble, lights,
candy cane or star tool. **Remove** clears whatever you click. **Done** or
Esc leaves decorate mode. Everything stays where you leave it across
restarts, and a snowman on a window travels with it between workspaces.

### Friends and the little train

1. **Set up friends** in the menu, then **Copy my code** and send it to a friend.
2. Copy their code and press **Add from clipboard** (or `flurry add <code>`).
3. Right-click a snowman or tree, **Send to …**. The train comes for it, and it
   pulls up on your friend's desktop. Notes go the same way.

Gifts travel over [ntfy](https://ntfy.sh): your inbox is a topic named after
128 random bits, so only someone with your code can send to it. Anyone who
has your code can, though, so share it with friends only. To use your own
ntfy server, set `"server"` in `~/.local/state/omarchy-flurry/state.json`.
Incoming gifts are size-checked and validated before anything is drawn.

## From the terminal

`bin/flurry` wraps the IPC target, handy for Hyprland binds:

```bash
flurry toggle | on | off | next
flurry effect rain
flurry intensity 1.5
flurry decorate | santa | yeti | clear
flurry code               # your friend code
flurry add flurry1:…      # or with no argument, from the clipboard
flurry note Ali "Merry Christmas!"
flurry status
```

or directly: `omarchy-shell flurry effect sakura`.

## Performance

Everything draws on one canvas per screen in batched paths. On battery the
effect is halved and capped at 30 fps (turn that off in the menu), and it
stops while a fullscreen app is up. Hyprland sends no events during an
interactive window drag, so while the effect is on the window list is
refreshed over Hyprland's socket every 220 ms, and every 50 ms for two seconds
after something moves. The pointer is read only for leaves and fireflies.

## Development

```bash
node --test tests/*.test.js        # simulation and state tests
omarchy plugin validate .
```

The simulation (`lib/sim.js`), drawing (`lib/draw.js`) and state
(`lib/store.js`) are plain JavaScript, so they run under node as well as in the
shell. `tests/render-preview.js` paints every effect to PNG with
`@napi-rs/canvas` for checking the art without a desktop.

| File | What it is |
|---|---|
| `Service.qml` | State, persistence, window and pointer feeds, visitors' schedule, friends inbox, IPC |
| `SceneWindow.qml` | One transparent layer per screen: weather, decorations, Santa, the Yeti, the train |
| `Widget.qml` | The bar icon and its menu |
| `Decoration.qml`, `Visitor.qml`, `ContextMenu.qml`, `Toolbar.qml` | Pieces of the scene |

Inspired by KoiArt for macOS and Windows. Flurry is an independent project;
all art is drawn in code.

MIT licensed.
