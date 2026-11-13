// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#include "components/oxygen_theme/oxygen_color_mixer.h"

#include "chrome/browser/ui/color/chrome_color_id.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/color/color_id.h"
#include "ui/color/color_mixer.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/color/color_recipe.h"

namespace oxygen {

void AddOxygenThemeColorMixer(ui::ColorProvider* provider,
                              const ui::ColorProviderKey& key) {
  if (key.custom_theme) {
    return;
  }

  if (key.color_mode != ui::ColorProviderKey::ColorMode::kDark) {
    return;
  }

  ui::ColorMixer& mixer = provider->AddMixer();

  // Obsidian Metallic palette aligned with the Oxygen emblem.
  constexpr SkColor kObsidianFrame = SkColorSetRGB(0x07, 0x08, 0x0B);
  constexpr SkColor kObsidianToolbar = SkColorSetRGB(0x0B, 0x0D, 0x12);
  constexpr SkColor kObsidianSurface = SkColorSetRGB(0x10, 0x12, 0x18);
  constexpr SkColor kObsidianBorder = SkColorSetRGB(0x22, 0x26, 0x33);
  constexpr SkColor kSilverPrimary = SkColorSetRGB(0xF3, 0xF5, 0xF8);
  constexpr SkColor kSilverAccent = SkColorSetRGB(0xD8, 0xDE, 0xE9);

  mixer[ui::kColorFrameActive] = {kObsidianFrame};
  mixer[ui::kColorFrameInactive] = {kObsidianFrame};
  mixer[kColorToolbar] = {kObsidianToolbar};
  mixer[kColorToolbarText] = {kSilverPrimary};
  mixer[kColorToolbarButtonIcon] = {kSilverAccent};
  mixer[kColorToolbarContentAreaSeparator] = {kObsidianBorder};
  mixer[kColorLocationBarBackground] = {
      ui::SetAlpha(kObsidianSurface, 0xCC)};
  mixer[kColorLocationBarBackgroundHovered] = {kObsidianSurface};
  mixer[kColorTabBackgroundActiveFrameActive] = {kObsidianToolbar};
  mixer[kColorTabBackgroundInactiveFrameActive] = {kObsidianFrame};
  mixer[kColorTabForegroundActiveFrameActive] = {kSilverPrimary};
}

}  // namespace oxygen
