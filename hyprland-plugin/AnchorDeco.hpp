#pragma once

#define WLR_USE_UNSTABLE

#include <hyprland/src/render/decorations/IHyprWindowDecoration.hpp>

// Flurry's frost, snow ledge and icicles for one window, drawn by the
// compositor with the window, at the window's position in this very frame.
// Flurry's overlay is a separate surface that only learns where a window is
// from Hyprland's socket, a few frames after the compositor moved it, so
// anything it paints "on" a moving window trails it. This decoration has no
// such lag: it is placed from the window's own render position.
class CFlurryAnchorDeco : public IHyprWindowDecoration {
  public:
    CFlurryAnchorDeco(PHLWINDOW);
    virtual ~CFlurryAnchorDeco();

    virtual SDecorationPositioningInfo getPositioningInfo();
    virtual void                       onPositioningReply(const SDecorationPositioningReply& reply);
    virtual void                       draw(PHLMONITOR, float const& a);
    virtual eDecorationType            getDecorationType();
    virtual void                       updateWindow(PHLWINDOW);
    virtual void                       damageEntire();
    virtual eDecorationLayer           getDecorationLayer();
    virtual uint64_t                   getDecorationFlags();
    virtual std::string                getDisplayName();

    void                               drawPass(PHLMONITOR, float const& a);
    // The strips changed: the box they cover may have grown.
    void                               refreshExtents();

  private:
    PHLWINDOWREF m_window;
    SBoxExtents  m_extents;
    Vector2D     m_lastPos, m_lastSize;
};
