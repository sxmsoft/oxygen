// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#ifndef CHROME_BROWSER_UI_WEBUI_OXYGEN_CONTROL_CENTER_OXYGEN_CONTROL_CENTER_HANDLER_H_
#define CHROME_BROWSER_UI_WEBUI_OXYGEN_CONTROL_CENTER_OXYGEN_CONTROL_CENTER_HANDLER_H_

#include "base/memory/raw_ptr.h"
#include "base/values.h"
#include "components/prefs/pref_change_registrar.h"
#include "content/public/browser/web_ui_message_handler.h"

class PrefService;
class Profile;

class OxygenControlCenterHandler : public content::WebUIMessageHandler {
 public:
  explicit OxygenControlCenterHandler(Profile* profile);
  OxygenControlCenterHandler(const OxygenControlCenterHandler&) = delete;
  OxygenControlCenterHandler& operator=(const OxygenControlCenterHandler&) = delete;
  ~OxygenControlCenterHandler() override;

  void RegisterMessages() override;

 private:
  void HandleGetState(const base::ListValue& args);
  void HandleSetPref(const base::ListValue& args);
  void HandleSetThemeTokens(const base::ListValue& args);
  void OnPreferencesChanged();
  base::DictValue CollectOxygenPrefs();

  raw_ptr<Profile> profile_;
  raw_ptr<PrefService> pref_service_;
  PrefChangeRegistrar pref_change_registrar_;
};

#endif  // CHROME_BROWSER_UI_WEBUI_OXYGEN_CONTROL_CENTER_OXYGEN_CONTROL_CENTER_HANDLER_H_
