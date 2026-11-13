// Copyright 2026 The Oxygen Browser Authors
// Licensed under GPL-3.0.

#include "chrome/browser/ui/webui/oxygen_control_center/oxygen_control_center_ui.h"

#include "base/strings/strcat.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/webui/oxygen_control_center/oxygen_control_center_handler.h"
#include "chrome/common/webui_url_constants.h"
#include "components/oxygen_control_center/resources/grit/oxygen_control_center_generated.h"
#include "components/oxygen_control_center/resources/grit/oxygen_control_center_generated_map.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/webui/webui_util.h"

OxygenControlCenterUI::OxygenControlCenterUI(content::WebUI* web_ui)
    : WebUIController(web_ui) {
  Profile* profile = Profile::FromWebUI(web_ui);
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      profile, chrome::kOxygenControlCenterHost);

  webui::SetupWebUIDataSource(source, kOxygenControlCenterGenerated,
                              IDR_OXYGEN_CONTROL_CENTER_INDEX_HTML);

  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::TrustedTypes,
      base::StrCat({webui::kDefaultTrustedTypesPolicies,
                    " svelte-trusted-html;"}));

  web_ui->AddMessageHandler(
      std::make_unique<OxygenControlCenterHandler>(profile));
}

OxygenControlCenterUI::~OxygenControlCenterUI() = default;
