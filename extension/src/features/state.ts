import { OXYGEN_CONFIG_STORAGE_KEY, isConfigBundle } from '../../../oxygen-core/src/ChromeStorageAdapter.js';
import type { OxygenConfigBundle } from '../../../oxygen-core/src/ConfigEngine.js';
import { isModuleEnabled, moduleConfig } from '../logic/moduleState.js';
import { FEATURE_MANIFESTS } from '../modules/manifests.js';
import { resolveLocale, translate, type Locale, type MessageKey } from '../logic/i18n.js';

/** Config access shared by the service worker and extension pages (reads chrome.storage.local). */
let cached: OxygenConfigBundle | null | undefined;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && OXYGEN_CONFIG_STORAGE_KEY in changes) cached = undefined;
});

export async function getBundle(): Promise<OxygenConfigBundle | null> {
  if (cached !== undefined) return cached;
  const raw = (await chrome.storage.local.get(OXYGEN_CONFIG_STORAGE_KEY))[OXYGEN_CONFIG_STORAGE_KEY];
  cached = isConfigBundle(raw) ? raw : null;
  return cached;
}

export async function featureEnabled(id: string): Promise<boolean> {
  return isModuleEnabled(await getBundle(), id, true);
}

export async function featureConfig<T>(id: string): Promise<T> {
  const m = FEATURE_MANIFESTS.find((x) => x.id === id);
  return moduleConfig<T>(await getBundle(), id, m?.configSchema ?? {});
}

export async function currentLocale(): Promise<Locale> {
  return resolveLocale((await getBundle())?.global?.language, chrome.i18n?.getUILanguage?.() ?? navigator.language);
}

export async function t(key: MessageKey, params?: Record<string, string | number>): Promise<string> {
  return translate(await currentLocale(), key, params);
}

export async function getKey<T>(key: string, fallback: T): Promise<T> {
  const v = (await chrome.storage.local.get(key))[key];
  return (v === undefined ? fallback : v) as T;
}

export async function setKey(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
