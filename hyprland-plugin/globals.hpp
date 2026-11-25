#pragma once

#include <hyprland/src/plugins/PluginAPI.hpp>
#include <hyprland/src/render/Texture.hpp>

#include <chrono>
#include <cstdint>
#include <string>
#include <unordered_map>

inline HANDLE PHANDLE = nullptr;

// What Flurry has painted for one window: up to two strips (the band along
// its top edge and the band along its bottom edge), each a PNG Flurry wrote
// and the offset of its top-left corner from the window's top-left corner,
// in layout px. The plugin only places them; Flurry paints them.
struct SFlurryStrip {
    std::string          path;
    double               ox = 0, oy = 0, w = 0, h = 0;
    uint64_t             seq       = 0; // bumped by every `flurry set`
    uint64_t             loadedSeq = 0; // the seq the texture was loaded at
    SP<Render::ITexture> tex;
};

struct SFlurryAnchor {
    SFlurryStrip strips[2];
};

// Keyed by the window's address as hyprctl prints it (the pointer value).
inline std::unordered_map<uintptr_t, SFlurryAnchor> g_anchors;

// When Flurry last spoke to the plugin. Flurry pings every few seconds
// while it runs; if it stops (quit, crashed, turned off), what it left on
// the windows is no longer drawn after ANCHOR_STALE, so nothing is left
// frozen on a window that Flurry no longer looks after.
inline std::chrono::steady_clock::time_point g_lastHeard = std::chrono::steady_clock::now();
inline constexpr auto                       ANCHOR_STALE = std::chrono::seconds(15);
inline bool                                 anchorsStale() {
    return std::chrono::steady_clock::now() - g_lastHeard > ANCHOR_STALE;
}
