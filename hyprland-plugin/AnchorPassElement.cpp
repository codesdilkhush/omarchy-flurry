#include "AnchorPassElement.hpp"
#include <hyprland/src/render/Renderer.hpp>
#include "AnchorDeco.hpp"

CFlurryAnchorPassElement::CFlurryAnchorPassElement(const SData& data_) : m_data(data_) {
    ;
}

std::vector<UP<IPassElement>> CFlurryAnchorPassElement::draw() {
    m_data.deco->drawPass(g_pHyprRenderer->m_renderData.pMonitor.lock(), m_data.a);
    return {};
}

bool CFlurryAnchorPassElement::needsLiveBlur() {
    return false;
}

bool CFlurryAnchorPassElement::needsPrecomputeBlur() {
    return false;
}
