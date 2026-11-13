import {
  OXYGEN_CONFIG_STORAGE_KEY,
  isConfigBundle,
} from '../../oxygen-core/src/ChromeStorageAdapter.js';
import { createDefaultBundle } from '../../oxygen-core/src/ConfigEngine.js';
import {
  CONTROL_CENTER_SECTIONS,
  THEME_MODULE_ID,
  THEME_NAME_PREFIX,
  THEME_LAUNCH_PACK_KEY,
  THEME_PACK_STATUS_KEY,
  THEME_VARIANTS,
  parseSection,
  themeNameFor,
  variantFromThemeName,
  type ThemePackStatus,
  type ThemeVariant,
} from './shared.js';
import './sw/features.js';
import { obsidianThemeManifest, resolveObsidianTokens, type ObsidianThemeConfig } from '../../modules/core-theme-obsidian/src/index.js';
import { moduleConfig } from './logic/moduleState.js';
import { OXYGEN_THEME_TOKENS_KEY } from './bridge.js';

/**
 * Oxygen service worker. Event-driven only: no polling (feature modules: ./sw/features.ts).
 * Replaces the fork's native pieces:
 * - OxygenThemeColorMixer -> enable the matching Oxygen theme pack
 * - oxygen://settings     -> action button, options page, new tab, `ox` keyword
 */

/** Which theme pack should be active for a stored config bundle (null = Helium default). */
export function desiredThemeVariant(raw: unknown): ThemeVariant | null {
  if (!isConfigBundle(raw)) return 'obsidian';
  // The theme module is default-enabled; it is off only when explicitly disabled.
  if ((raw.disabledModuleIds ?? []).includes(THEME_MODULE_ID)) return null;
  const v = raw.modules[THEME_MODULE_ID]?.surfaceContrast;
  return (THEME_VARIANTS as readonly unknown[]).includes(v) ? (v as ThemeVariant) : 'obsidian';
}

async function oxygenThemePacks(): Promise<chrome.management.ExtensionInfo[]> {
  return (await chrome.management.getAll()).filter(
    (e) => e.type === 'theme' && e.name.startsWith(THEME_NAME_PREFIX)
  );
}

/**
 * Enables the theme pack matching the config. If that pack is not installed
 * (Chromium uninstalls unused themes), the current browser theme is left as is
 * and the Control Center shows how to load the pack.
 */
async function applyBrowserTheme(raw: unknown): Promise<void> {
  const desired = desiredThemeVariant(raw);
  const packs = await oxygenThemePacks();
  const target = desired ? packs.find((p) => p.name === themeNameFor(desired)) : undefined;

  if (desired === null || target) {
    if (target && !target.enabled) await chrome.management.setEnabled(target.id, true);
    for (const p of packs) {
      if (p !== target && p.enabled) await chrome.management.setEnabled(p.id, false);
    }
  }

  const after = await oxygenThemePacks();
  const status: ThemePackStatus = {
    desired,
    active: variantFromThemeName(after.find((p) => p.enabled)?.name ?? ''),
    installed: after
      .map((p) => variantFromThemeName(p.name))
      .filter((v): v is ThemeVariant => v !== null),
  };
  // Page tokens for contexts without an OxygenCore (injected palette, popup).
  const tokens = resolveObsidianTokens(
    moduleConfig<ObsidianThemeConfig>(isConfigBundle(raw) ? raw : null, THEME_MODULE_ID, obsidianThemeManifest.configSchema)
  );
  await chrome.storage.local.set({ [THEME_PACK_STATUS_KEY]: status, [OXYGEN_THEME_TOKENS_KEY]: tokens });
}

/**
 * Browser start: if the launcher switched theme packs since the previous start
 * (scripts/oxygen-launch.sh --theme X), Surface Contrast follows the new pack so
 * page and browser frame agree. Otherwise the stored config is applied as is,
 * so a start never overwrites settings the user changed meanwhile.
 */
async function syncThemeFromStorage(): Promise<void> {
  const got = await chrome.storage.local.get([OXYGEN_CONFIG_STORAGE_KEY, THEME_LAUNCH_PACK_KEY]);
  const stored = got[OXYGEN_CONFIG_STORAGE_KEY];
  const previousPack = got[THEME_LAUNCH_PACK_KEY] as ThemeVariant | undefined;
  const active = variantFromThemeName(
    (await oxygenThemePacks()).find((p) => p.enabled)?.name ?? ''
  );
  if (active) await chrome.storage.local.set({ [THEME_LAUNCH_PACK_KEY]: active });

  const packChanged = active !== null && previousPack !== undefined && previousPack !== active;
  const noConfigYet = !isConfigBundle(stored);
  if (active && (packChanged || noConfigYet)) {
    const bundle = isConfigBundle(stored) ? structuredClone(stored) : createDefaultBundle();
    const themeOn = !(bundle.disabledModuleIds ?? []).includes(THEME_MODULE_ID);
    if (themeOn && bundle.modules[THEME_MODULE_ID]?.surfaceContrast !== active) {
      bundle.modules[THEME_MODULE_ID] = {
        ...(bundle.modules[THEME_MODULE_ID] ?? {}),
        surfaceContrast: active,
      };
      // onChanged -> applyBrowserTheme + open Control Center tabs update
      await chrome.storage.local.set({ [OXYGEN_CONFIG_STORAGE_KEY]: bundle });
      return;
    }
  }
  await applyBrowserTheme(stored);
}

chrome.runtime.onInstalled.addListener(() => void syncThemeFromStorage());
chrome.runtime.onStartup.addListener(() => void syncThemeFromStorage());
// A theme pack loaded later than Oxygen itself: apply the config (no adoption,
// so a running session never overwrites the user's choice).
chrome.management.onInstalled.addListener((info) => {
  if (info.type !== 'theme' || !info.name.startsWith(THEME_NAME_PREFIX)) return;
  void chrome.storage.local
    .get(OXYGEN_CONFIG_STORAGE_KEY)
    .then((r) => applyBrowserTheme(r[OXYGEN_CONFIG_STORAGE_KEY]));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && OXYGEN_CONFIG_STORAGE_KEY in changes) {
    void applyBrowserTheme(changes[OXYGEN_CONFIG_STORAGE_KEY].newValue);
  }
});

/** Opens the Control Center (action button, `ox` keyword). */
export async function openControlCenter(
  section: string = 'dashboard',
  disposition: `${chrome.omnibox.OnInputEnteredDisposition}` = 'newForegroundTab'
): Promise<void> {
  const url = chrome.runtime.getURL(`index.html#${parseSection(section) ?? 'dashboard'}`);
  if (disposition === 'currentTab') await chrome.tabs.update({ url });
  else await chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
}
// Exposed for the headless e2e check (tests/e2e/verify_extension.mjs).
(globalThis as { oxygenOpenControlCenter?: typeof openControlCenter }).oxygenOpenControlCenter =
  openControlCenter;

chrome.action.onClicked.addListener(() => void openControlCenter());

chrome.omnibox.setDefaultSuggestion({ description: 'Open Oxygen Control Center' });
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const q = text.trim().toLowerCase();
  suggest(
    CONTROL_CENTER_SECTIONS.filter((s) => s.startsWith(q) && s !== q).map((s) => ({
      content: s,
      description: `Oxygen Control Center: ${s}`,
    }))
  );
});
chrome.omnibox.onInputEntered.addListener(
  (text, disposition) => void openControlCenter(text, disposition)
);
