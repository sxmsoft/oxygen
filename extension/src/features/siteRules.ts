import { cssFor, matchRules, parseRules, toggleDarkForHost, type SiteRule } from '../logic/siteRules.js';
import { hostOf } from '../logic/domains.js';
import { STORAGE_KEYS } from '../modules/manifests.js';
import { featureConfig, featureEnabled, getKey, setKey } from './state.js';

const MODULE = 'site-rules';
/** storage.session: what we injected per tab, so it can be removed when rules change. */
const APPLIED_KEY = 'oxygen.sites.applied';

interface AppliedState {
  css: string;
  zoom: number | null;
}

export async function getRules(): Promise<SiteRule[]> {
  return parseRules(await getKey<unknown>(STORAGE_KEYS.siteRules, []));
}

export async function setRules(rules: SiteRule[]): Promise<void> {
  await setKey(STORAGE_KEYS.siteRules, parseRules(rules));
}

export function newRuleId(): string {
  return `rule-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function appliedMap(): Promise<Record<string, AppliedState>> {
  return ((await chrome.storage.session.get(APPLIED_KEY))[APPLIED_KEY] as Record<string, AppliedState>) ?? {};
}
async function setApplied(tabId: number, state: AppliedState | null): Promise<void> {
  const m = await appliedMap();
  if (state) m[tabId] = state;
  else delete m[tabId];
  await chrome.storage.session.set({ [APPLIED_KEY]: m });
}

export async function forgetTab(tabId: number): Promise<void> {
  await setApplied(tabId, null);
}

/**
 * Applies the matching rules to a tab's current document.
 * `freshDocument` = a navigation just committed, so previously injected CSS is gone already.
 */
export async function applyToTab(tabId: number, url: string, freshDocument: boolean): Promise<{ css: string; zoom: number | null }> {
  const enabled = await featureEnabled(MODULE);
  const cfg = await featureConfig<{ applyZoom: boolean; applyStyles: boolean }>(MODULE);
  const applied = enabled ? matchRules(await getRules(), url) : { zoom: null, forceDark: false, css: [], matched: [] };
  const css = enabled && cfg.applyStyles ? cssFor(applied) : '';
  const zoom = enabled && cfg.applyZoom ? applied.zoom : null;
  const prev = (await appliedMap())[tabId];

  if (prev?.css && !freshDocument && prev.css !== css) {
    await chrome.scripting.removeCSS({ target: { tabId, allFrames: false }, css: prev.css, origin: 'USER' }).catch(() => {});
  }
  if (css && (freshDocument || prev?.css !== css)) {
    await chrome.scripting.insertCSS({ target: { tabId }, css, origin: 'USER' }).catch(() => {});
  }
  if (zoom !== null) {
    await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' }).catch(() => {});
    await chrome.tabs.setZoom(tabId, zoom).catch(() => {});
  } else if (prev?.zoom != null) {
    await chrome.tabs.setZoom(tabId, 0).catch(() => {});
    await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-origin' }).catch(() => {});
  }
  await setApplied(tabId, css || zoom !== null ? { css, zoom } : null);
  return { css, zoom };
}

export async function applyToAllTabs(): Promise<void> {
  for (const t of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (t.id !== undefined && t.url && !t.discarded) await applyToTab(t.id, t.url, false);
  }
}

/** Quick toggle used by the palette, side panel and Control Center. */
export async function toggleDarkForTab(tabId: number): Promise<{ host: string; dark: boolean } | null> {
  const tab = await chrome.tabs.get(tabId);
  const host = hostOf(tab.url);
  if (!host || !/^https?:/.test(tab.url ?? '')) return null;
  const res = toggleDarkForHost(await getRules(), host.replace(/^www\./, ''), newRuleId());
  await setRules(res.rules); // storage.onChanged -> applyToAllTabs
  return { host, dark: res.dark };
}
