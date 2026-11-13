import { rank } from '../logic/search.js';
import { tabCount } from '../logic/workspace.js';
import type { MessageKey } from '../logic/i18n.js';
import { featureConfig, featureEnabled, t } from './state.js';
import { suspendOthers, suspendTab } from './suspender.js';
import { getStore, restoreById, saveWorkspace } from './workspaces.js';
import { toggleDarkForTab } from './siteRules.js';

export type PaletteKind = 'command' | 'tab' | 'workspace' | 'bookmark' | 'history';

export interface PaletteItem {
  kind: PaletteKind;
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  /** favicon URL (chrome-extension://…/_favicon/) */
  icon?: string;
  tabId?: number;
  windowId?: number;
  boost?: number;
}

export const PALETTE_COMMANDS: { id: string; key: MessageKey; module?: string }[] = [
  { id: 'suspend-tab', key: 'cmd.suspend-tab', module: 'tab-suspender' },
  { id: 'suspend-others', key: 'cmd.suspend-others', module: 'tab-suspender' },
  { id: 'save-workspace', key: 'cmd.save-workspace', module: 'workspaces' },
  { id: 'restore-session', key: 'cmd.restore-session', module: 'workspaces' },
  { id: 'toggle-dark', key: 'cmd.toggle-dark', module: 'site-rules' },
  { id: 'open-side-panel', key: 'cmd.open-side-panel', module: 'side-panel' },
  { id: 'open-settings', key: 'cmd.open-settings' },
];

export function faviconUrl(pageUrl: string, size = 32): string {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

export async function paletteSearch(query: string): Promise<PaletteItem[]> {
  const q = query.trim();
  const cfg = await featureConfig<{ includeHistory: boolean; includeBookmarks: boolean }>('command-palette');
  const items: PaletteItem[] = [];

  for (const c of PALETTE_COMMANDS) {
    if (c.module && !(await featureEnabled(c.module))) continue;
    items.push({ kind: 'command', id: c.id, title: await t(c.key), subtitle: 'Oxygen', boost: q ? 5 : 0 });
  }
  for (const tab of await chrome.tabs.query({})) {
    if (!tab.url || tab.id === undefined) continue;
    items.push({
      kind: 'tab', id: `tab-${tab.id}`, title: tab.title || tab.url, subtitle: tab.url, url: tab.url,
      icon: faviconUrl(tab.url), tabId: tab.id, windowId: tab.windowId, boost: 3,
    });
  }
  if (await featureEnabled('workspaces')) {
    for (const ws of (await getStore()).saved) {
      items.push({ kind: 'workspace', id: ws.id, title: ws.name, subtitle: await t('ws.tabs', { n: tabCount(ws) }), boost: 2 });
    }
  }
  if (q && cfg.includeBookmarks && chrome.bookmarks) {
    for (const b of (await chrome.bookmarks.search(q)).slice(0, 20)) {
      if (b.url) items.push({ kind: 'bookmark', id: `bm-${b.id}`, title: b.title || b.url, subtitle: b.url, url: b.url, icon: faviconUrl(b.url), boost: 1 });
    }
  }
  if (q && cfg.includeHistory && chrome.history) {
    for (const h of await chrome.history.search({ text: q, maxResults: 25, startTime: 0 })) {
      if (h.url) items.push({ kind: 'history', id: `h-${h.id}`, title: h.title || h.url, subtitle: h.url, url: h.url, icon: faviconUrl(h.url) });
    }
  }
  // Without a query: commands first, then tabs by recency.
  if (!q) return items.filter((i) => i.kind === 'command' || i.kind === 'tab' || i.kind === 'workspace').slice(0, 30);
  // De-duplicate URLs (an open tab beats a bookmark/history entry).
  const seen = new Set<string>();
  return rank(items, q, 40).filter((i) => {
    if (!i.url) return true;
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    return true;
  });
}

export async function openControlCenterTab(section = 'dashboard'): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`index.html#${section}`) });
}

export async function openSidePanel(windowId: number | undefined): Promise<boolean> {
  if (!chrome.sidePanel || windowId === undefined) return false;
  try {
    await chrome.sidePanel.open({ windowId });
    return true;
  } catch {
    return false;
  }
}

/** Runs a palette selection. `tab` is the tab the palette was opened from. */
export async function paletteRun(item: PaletteItem, tab: chrome.tabs.Tab | undefined, newTab = false): Promise<{ ok: boolean; message?: string }> {
  switch (item.kind) {
    case 'tab':
      if (item.tabId === undefined) return { ok: false };
      await chrome.tabs.update(item.tabId, { active: true });
      if (item.windowId !== undefined) await chrome.windows.update(item.windowId, { focused: true });
      return { ok: true };
    case 'workspace':
      return { ok: (await restoreById(item.id)).length > 0 };
    case 'bookmark':
    case 'history': {
      if (!item.url) return { ok: false };
      const isBlank = !tab?.url || tab.url.startsWith(chrome.runtime.getURL('')) || tab.url.startsWith('chrome://newtab');
      if (tab?.id !== undefined && isBlank && !newTab) await chrome.tabs.update(tab.id, { url: item.url });
      else await chrome.tabs.create({ url: item.url, windowId: tab?.windowId, index: tab ? tab.index + 1 : undefined });
      return { ok: true };
    }
    case 'command':
      return runCommand(item.id, tab);
  }
}

export async function runCommand(id: string, tab: chrome.tabs.Tab | undefined): Promise<{ ok: boolean; message?: string }> {
  switch (id) {
    case 'suspend-tab':
      return { ok: tab?.id !== undefined && (await suspendTab(tab.id)) };
    case 'suspend-others': {
      const n = tab?.windowId !== undefined ? await suspendOthers(tab.windowId) : 0;
      return { ok: true, message: String(n) };
    }
    case 'save-workspace': {
      const ws = await saveWorkspace('', tab?.windowId);
      return { ok: !!ws, message: ws?.name };
    }
    case 'restore-session':
      return { ok: (await restoreById('last')).length > 0 };
    case 'toggle-dark': {
      const r = tab?.id !== undefined ? await toggleDarkForTab(tab.id) : null;
      return r ? { ok: true, message: await t('sites.toggleDark', { host: r.host }) + (r.dark ? ' ✓' : ' ✗') } : { ok: false };
    }
    case 'open-side-panel':
      return { ok: await openSidePanel(tab?.windowId) };
    case 'open-settings':
      await openControlCenterTab();
      return { ok: true };
  }
  return { ok: false };
}
