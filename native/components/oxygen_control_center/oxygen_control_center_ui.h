// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#ifndef CHROME_BROWSER_UI_WEBUI_OXYGEN_CONTROL_CENTER_OXYGEN_CONTROL_CENTER_UI_H_
#define CHROME_BROWSER_UI_WEBUI_OXYGEN_CONTROL_CENTER_OXYGEN_CONTROL_CENTER_UI_H_

#include "chrome/common/webui_url_constants.h"
#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/webui_config.h"

class OxygenControlCenterUI;

class OxygenControlCenterUIConfig
    : public content::DefaultWebUIConfig<OxygenControlCenterUI> {
 public:
  OxygenControlCenterUIConfig()
      : DefaultWebUIConfig(content::kChromeUIScheme,
                           chrome::kOxygenControlCenterHost) {}
};

class OxygenControlCenterUI : public content::WebUIController {
 public:
  explicit OxygenControlCenterUI(content::WebUI* web_ui);
  OxygenControlCenterUI(const OxygenControlCenterUI&) = delete;
  OxygenControlCenterUI& operator=(const OxygenControlCenterUI&) = delete;
  ~OxygenControlCenterUI() override;
};

#endif  // CHROME_BROWSER_UI_WEBUI_OXYGEN_CONTROL_CENTER_OXYGEN_CONTROL_CENTER_UI_H_
