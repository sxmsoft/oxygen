// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#ifndef COMPONENTS_OXYGEN_CORE_OXYGEN_CORE_PREFS_H_
#define COMPONENTS_OXYGEN_CORE_OXYGEN_CORE_PREFS_H_

namespace user_prefs {
class PrefRegistrySyncable;
}

namespace oxygen {

void RegisterProfilePrefs(user_prefs::PrefRegistrySyncable* registry);

}  // namespace oxygen

#endif  // COMPONENTS_OXYGEN_CORE_OXYGEN_CORE_PREFS_H_
