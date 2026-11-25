#pragma once
#include <hyprland/src/render/pass/PassElement.hpp>

class CFlurryAnchorDeco;

class CFlurryAnchorPassElement : public IPassElement {
  public:
    struct SData {
        CFlurryAnchorDeco* deco = nullptr;
        float              a    = 1.F;
    };

    CFlurryAnchorPassElement(const SData& data_);
    virtual ~CFlurryAnchorPassElement() = default;

    virtual std::vector<UP<IPassElement>> draw() override;
    virtual bool                          needsLiveBlur() override;
    virtual bool                          needsPrecomputeBlur() override;

    virtual const char*                   passName() override {
        return "CFlurryAnchorPassElement";
    }

    virtual ePassElementType type() override {
        return EK_CUSTOM;
    }

  private:
    SData m_data;
};
