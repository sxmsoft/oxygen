/// <reference path="./chrome.d.ts" />
import type { ThemeTokens } from '../../sdk/src/types.js';
import type { NativeBridge } from '../../oxygen-core/src/NativeBridge.js';

export const OXYGEN_PREF_PREFIX = 'oxygen.';
export const OXYGEN_THEME_TOKENS_KEY = 'oxygen.theme.tokens';

/**
 * Extension replacement for the fork's OxygenControlCenterHandler:
 * values go to chrome.storage.local instead of PrefService, and every context
 * (tabs, service worker) observes them through chrome.storage.onChanged.
 */
export class ExtensionBridge implements NativeBridge {
  readonly mode = 'extension' as const;

  pushThemeTokens(tokens: Partial<ThemeTokens>): void {
    void chrome.storage.local.set({ [OXYGEN_THEME_TOKENS_KEY]: tokens });
  }

  pushPref(key: string, value: unknown): void {
    if (!key.startsWith(OXYGEN_PREF_PREFIX)) return;
    void chrome.storage.local.set({ [key]: value });
  }
}

export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string';
}
