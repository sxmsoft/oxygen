// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#include "chrome/browser/ui/webui/oxygen_control_center/oxygen_control_center_handler.h"

#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "chrome/browser/profiles/profile.h"
#include "components/oxygen_core/oxygen_pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_ui.h"

OxygenControlCenterHandler::OxygenControlCenterHandler(Profile* profile)
    : profile_(profile), pref_service_(profile_->GetPrefs()) {
  pref_change_registrar_.Init(pref_service_);
  for (const char* pref_name : {
           oxygen::prefs::kOxygenCoreEnabled,
           oxygen::prefs::kOxygenThemeActiveId,
           oxygen::prefs::kOxygenThemeSurfaceContrast,
           oxygen::prefs::kOxygenThemeAccentColor,
           oxygen::prefs::kOxygenThemeCornerRadiusPx,
           oxygen::prefs::kOxygenThemeMotionScale,
           oxygen::prefs::kOxygenThemeTranslucentOmnibox,
           oxygen::prefs::kOxygenEnabledModules,
       }) {
    pref_change_registrar_.Add(
        pref_name,
        base::BindRepeating(&OxygenControlCenterHandler::OnPreferencesChanged,
                            base::Unretained(this)));
  }
}

OxygenControlCenterHandler::~OxygenControlCenterHandler() = default;

void OxygenControlCenterHandler::RegisterMessages() {
  web_ui()->RegisterMessageCallback(
      "oxygenGetState",
      base::BindRepeating(&OxygenControlCenterHandler::HandleGetState,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "oxygenSetPref",
      base::BindRepeating(&OxygenControlCenterHandler::HandleSetPref,
                          base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "oxygenSetThemeTokens",
      base::BindRepeating(&OxygenControlCenterHandler::HandleSetThemeTokens,
                          base::Unretained(this)));
}

base::DictValue OxygenControlCenterHandler::CollectOxygenPrefs() {
  base::DictValue output;
  for (const auto& [name, value, _] :
       pref_service_->GetPreferencesValueAndStore()) {
    if (base::StartsWith(name, oxygen::prefs::kOxygenPrefPrefix,
                         base::CompareCase::SENSITIVE)) {
      output.Set(name, value.Clone());
    }
  }
  return output;
}

void OxygenControlCenterHandler::OnPreferencesChanged() {
  AllowJavascript();
  FireWebUIListener("oxygen-state-changed", CollectOxygenPrefs());
}

void OxygenControlCenterHandler::HandleGetState(const base::ListValue& args) {
  AllowJavascript();
  if (args.empty()) {
    return;
  }
  ResolveJavascriptCallback(args[0], CollectOxygenPrefs());
}

void OxygenControlCenterHandler::HandleSetPref(const base::ListValue& args) {
  if (args.size() < 2 || !args[0].is_string()) {
    return;
  }
  const std::string& pref_name = args[0].GetString();
  if (!base::StartsWith(pref_name, oxygen::prefs::kOxygenPrefPrefix,
                        base::CompareCase::SENSITIVE)) {
    return;
  }
  if (pref_service_->FindPreference(pref_name)) {
    pref_service_->Set(pref_name, args[1]);
  }
}

void OxygenControlCenterHandler::HandleSetThemeTokens(
    const base::ListValue& args) {
  if (args.empty() || !args[0].is_dict()) {
    return;
  }
  const base::DictValue& dict = args[0].GetDict();
  if (const std::string* accent = dict.FindString("accentColor")) {
    pref_service_->SetString(oxygen::prefs::kOxygenThemeAccentColor, *accent);
  }
  if (std::optional<int> radius = dict.FindInt("cornerRadiusPx")) {
    pref_service_->SetInteger(oxygen::prefs::kOxygenThemeCornerRadiusPx,
                              *radius);
  }
  if (std::optional<double> motion = dict.FindDouble("motionScale")) {
    pref_service_->SetDouble(oxygen::prefs::kOxygenThemeMotionScale, *motion);
  }
}
