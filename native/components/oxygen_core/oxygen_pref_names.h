// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#ifndef COMPONENTS_OXYGEN_CORE_OXYGEN_PREF_NAMES_H_
#define COMPONENTS_OXYGEN_CORE_OXYGEN_PREF_NAMES_H_

namespace oxygen::prefs {

inline constexpr char kOxygenPrefPrefix[] = "oxygen.";

inline constexpr char kOxygenCoreEnabled[] = "oxygen.core.enabled";
inline constexpr char kOxygenThemeActiveId[] = "oxygen.theme.active_id";
inline constexpr char kOxygenThemeSurfaceContrast[] = "oxygen.theme.surface_contrast";
inline constexpr char kOxygenThemeAccentColor[] = "oxygen.theme.accent_color";
inline constexpr char kOxygenThemeCornerRadiusPx[] = "oxygen.theme.corner_radius_px";
inline constexpr char kOxygenThemeMotionScale[] = "oxygen.theme.motion_scale";
inline constexpr char kOxygenThemeTranslucentOmnibox[] = "oxygen.theme.translucent_omnibox";
inline constexpr char kOxygenEnabledModules[] = "oxygen.modules.enabled_ids";

}  // namespace oxygen::prefs

#endif  // COMPONENTS_OXYGEN_CORE_OXYGEN_PREF_NAMES_H_
