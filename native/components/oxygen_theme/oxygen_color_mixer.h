// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#ifndef COMPONENTS_OXYGEN_THEME_OXYGEN_COLOR_MIXER_H_
#define COMPONENTS_OXYGEN_THEME_OXYGEN_COLOR_MIXER_H_

namespace ui {
class ColorProvider;
struct ColorProviderKey;
}  // namespace ui

namespace oxygen {

void AddOxygenThemeColorMixer(ui::ColorProvider* provider,
                              const ui::ColorProviderKey& key);

}  // namespace oxygen

#endif  // COMPONENTS_OXYGEN_THEME_OXYGEN_COLOR_MIXER_H_
