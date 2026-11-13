// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#include "components/oxygen_core/oxygen_core_prefs.h"

#include "base/values.h"
#include "components/oxygen_core/oxygen_pref_names.h"
#include "components/pref_registry/pref_registry_syncable.h"

namespace oxygen {

void RegisterProfilePrefs(user_prefs::PrefRegistrySyncable* registry) {
  registry->RegisterBooleanPref(prefs::kOxygenCoreEnabled, true);
  registry->RegisterStringPref(prefs::kOxygenThemeActiveId, "core-theme-obsidian");
  registry->RegisterStringPref(prefs::kOxygenThemeSurfaceContrast, "obsidian");
  registry->RegisterStringPref(prefs::kOxygenThemeAccentColor, "#D8DEE9");
  registry->RegisterIntegerPref(prefs::kOxygenThemeCornerRadiusPx, 10);
  registry->RegisterDoublePref(prefs::kOxygenThemeMotionScale, 1.0);
  registry->RegisterBooleanPref(prefs::kOxygenThemeTranslucentOmnibox, true);

  base::ListValue default_modules;
  default_modules.Append("core-theme-obsidian");
  default_modules.Append("core-perf-guard");
  registry->RegisterListPref(prefs::kOxygenEnabledModules, std::move(default_modules));
}

}  // namespace oxygen
