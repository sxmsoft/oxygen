/**
 * Service-worker side of the feature modules. Everything is event driven:
 * per-tab one-shot alarms for the suspender, a short debounce for session
 * autosave, webNavigation for site rules. No intervals, no polling.
 */
import { OXYGEN_CONFIG_STORAGE_KEY } from '../../../oxygen-core/src/ChromeStorageAdapter.js';
import type { OxygenConfigBundle } from '../../../oxygen-core/src/ConfigEngine.js';
import { STORAGE_KEYS } from '../modules/manifests.js';
import { suspendDecision, type SuspenderConfig } from '../logic/suspender.js';
import { featureConfig, featureEnabled } from '../features/state.js';
import {
  SUSPEND_ALARM_PREFIX, onSuspendAlarm, reconcileSuspender, scheduleTab, suspenderStats,
} from '../features/suspender.js';
import { autosaveSession, getStore, restoreById, rotateOnStartup, saveWorkspace } from '../features/workspaces.js';
import { applyToAllTabs, applyToTab, forgetTab } from '../features/siteRules.js';
import { ingestShortcuts } from '../features/shortcuts.js';
import { openSidePanel, paletteRun, paletteSearch, runCommand, type PaletteItem } from '../features/palette.js';

const EXT_ORIGIN = chrome.runtime.getURL('');

// ---------- Suspender ----------
chrome.alarms.onAlarm.addListener((a) => void onSuspendAlarm(a.name));

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await chrome.alarms.clear(SUSPEND_ALARM_PREFIX + tabId);
  if (!(await featureEnabled('tab-suspender'))) return;
  const recent = Date.now() - 5 * 60_000;
  for (const t of await chrome.tabs.query({ windowId, active: false, discarded: false })) {
    if ((t.lastAccessed ?? 0) >= recent) await scheduleTab(t);
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.audible !== undefined || info.pinned !== undefined || info.status === 'complete') {
    if (!tab.active && (await featureEnabled('tab-suspender'))) await scheduleTab(tab);
  }
});
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.active && (await featureEnabled('tab-suspender'))) await scheduleTab(tab);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.alarms.clear(SUSPEND_ALARM_PREFIX + tabId);
  void forgetTab(tabId);
});

// ---------- Workspaces: autosave ----------
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutosave(): void {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    autosaveTimer = undefined;
    if ((await featureEnabled('workspaces')) && (await featureConfig<{ autosave: boolean }>('workspaces')).autosave) {
      await autosaveSession();
    }
  }, 3000);
}
chrome.tabs.onCreated.addListener(scheduleAutosave);
chrome.tabs.onMoved.addListener(scheduleAutosave);
chrome.tabs.onAttached.addListener(scheduleAutosave);
chrome.tabs.onRemoved.addListener((_id, info) => {
  if (!info.isWindowClosing) scheduleAutosave();
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url !== undefined || info.pinned !== undefined || info.groupId !== undefined || info.title !== undefined) scheduleAutosave();
});
chrome.tabGroups?.onUpdated.addListener(scheduleAutosave);
// A closing window must not shrink the autosave (browser shutdown closes windows one by one).
chrome.windows.onRemoved.addListener(() => clearTimeout(autosaveTimer));

// ---------- Site rules ----------
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
  void applyToTab(d.tabId, d.url, true);
});

// ---------- Command palette & side panel ----------
let lastPaletteError = '';
async function openPaletteFor(tab: chrome.tabs.Tab | undefined): Promise<string> {
  if (!(await featureEnabled('command-palette')) || !tab?.id) return 'disabled';
  const url = tab.url ?? '';
  if (url.startsWith(EXT_ORIGIN)) {
    // Oxygen pages render the palette themselves.
    await chrome.runtime.sendMessage({ type: 'palette:open', tabId: tab.id }).catch(() => {});
    return 'page';
  }
  if (/^(https?|file):/.test(url)) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/palette.js'] });
      return 'content';
    } catch (e) {
      // e.g. the Web Store or a PDF: fall back to the popup
      lastPaletteError = String((e as Error)?.message ?? e);
    }
  }
  await chrome.windows.create({
    url: chrome.runtime.getURL(`palette.html?tab=${tab.id}`),
    type: 'popup',
    width: 680,
    height: 520,
    focused: true,
  });
  return 'popup';
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-palette') await openPaletteFor(tab);
  else if (command === 'open-side-panel' && (await featureEnabled('side-panel'))) await openSidePanel(tab?.windowId);
});

async function syncSidePanel(): Promise<void> {
  if (!chrome.sidePanel) return;
  const enabled = await featureEnabled('side-panel');
  await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled }).catch(() => {});
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  const fromTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    if (typeof msg.tabId === 'number') return chrome.tabs.get(msg.tabId).catch(() => undefined);
    return sender.tab;
  };
  const handle = async (): Promise<unknown> => {
    switch (msg.type) {
      case 'palette:search':
        return paletteSearch(String(msg.q ?? ''));
      case 'palette:run':
        return paletteRun(msg.item as PaletteItem, await fromTab(), !!msg.newTab);
      case 'palette:command':
        return runCommand(String(msg.id), await fromTab());
      case 'palette:openFor':
        return openPaletteFor(await fromTab());
      case 'suspender:stats':
        return suspenderStats();
      case 'workspaces:restore':
        return restoreById(String(msg.id));
      case 'shortcuts:import':
        return ingestShortcuts(true);
      default:
        return undefined;
    }
  };
  if (!['palette:search', 'palette:run', 'palette:command', 'palette:openFor', 'suspender:stats', 'workspaces:restore', 'shortcuts:import'].includes(msg.type)) {
    return false;
  }
  handle().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
  return true;
});

// ---------- Lifecycle & config changes ----------
async function startAll(): Promise<void> {
  await ingestShortcuts().catch(() => {});
  await syncSidePanel();
  await reconcileSuspender();
  await applyToAllTabs();
}
chrome.runtime.onInstalled.addListener(() => void startAll());
chrome.runtime.onStartup.addListener(async () => {
  await rotateOnStartup();
  await startAll();
});

function slice(b: OxygenConfigBundle | undefined, id: string): string {
  if (!b) return '';
  return JSON.stringify([b.enabledModuleIds.includes(id), (b.disabledModuleIds ?? []).includes(id), b.modules[id] ?? null]);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const c = changes[OXYGEN_CONFIG_STORAGE_KEY];
  if (c) {
    const o = c.oldValue as OxygenConfigBundle | undefined;
    const n = c.newValue as OxygenConfigBundle | undefined;
    if (slice(o, 'tab-suspender') !== slice(n, 'tab-suspender')) void reconcileSuspender();
    if (slice(o, 'site-rules') !== slice(n, 'site-rules')) void applyToAllTabs();
    if (slice(o, 'side-panel') !== slice(n, 'side-panel')) void syncSidePanel();
  }
  if (changes[STORAGE_KEYS.siteRules]) void applyToAllTabs();
});

// Hooks for the headless e2e (tests/e2e/verify_extension.mjs); harmless in normal use.
(globalThis as Record<string, unknown>).oxygenTest = {
  reconcileSuspender,
  suspenderStats,
  autosaveSession,
  saveWorkspace,
  restoreById,
  getStore,
  applyToAllTabs,
  paletteSearch,
  runCommand,
  openPaletteFor: async (tabId: number) => openPaletteFor(await chrome.tabs.get(tabId)),
  commands: () => chrome.commands.getAll(),
  lastPaletteError: () => lastPaletteError,
  ingestShortcuts,
  explainSuspend: async (now = Date.now()) => {
    const cfg = await featureConfig<SuspenderConfig>('tab-suspender');
    return (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url, status: t.status, ...suspendDecision(t, cfg, now) }));
  },
};
