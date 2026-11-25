# flurry-anchor

A small Hyprland plugin that keeps Flurry's frost, snow ledges and icicles
on their windows while you move, drag or shake them.

Flurry's overlay is its own surface. It only learns where a window is from
Hyprland's socket, two to three frames after the compositor has already
moved the window, so anything it paints "on" a moving window trails it
(on a hard shake, by over 100 px). With this plugin the compositor draws
those things itself, as a decoration of the window, at the window's
position in the very frame it draws, so they cannot trail it. Flurry still
paints them (into two strips per window, saved under
`$XDG_RUNTIME_DIR/flurry-anchor/`); the plugin only places them. Falling
snow and the snow a shaken window throws off stay on the overlay as before.

Without the plugin Flurry works exactly as before.

## Install

With hyprpm (rebuilds itself when Hyprland updates):

    hyprpm add <url of this repository>
    hyprpm enable flurry-anchor

Or by hand, from this folder (needs Hyprland's headers: `hyprpm update`
installs them):

    make
    hyprctl plugin load "$PWD/flurry-anchor.so"

Flurry notices the plugin within a few seconds (its log says
"compositor plugin found"). `hyprctl flurry ping` answers
`flurry-anchor ok 1.0` when it is loaded.

## Commands (Flurry sends these; listed for debugging)

    hyprctl flurry ping
    hyprctl flurry set <0xaddress> <top|bottom> <ox> <oy> <w> <h> <png path>
    hyprctl flurry clear <0xaddress>
    hyprctl flurry clearall

If Flurry stops talking to it for 15 s (quit, crashed, turned off), the
plugin stops drawing what Flurry left, so nothing stays frozen on a window.

## Tests

    make test      # the command parser, no Hyprland needed

Built against Hyprland 0.56.2's plugin API.
