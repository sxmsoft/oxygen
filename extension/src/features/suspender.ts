import { suspendDecision, estimateSavedMb, ESTIMATED_MB_PER_DISCARDED_TAB, type SuspenderConfig } from '../logic/suspender.js';
import { STORAGE_KEYS } from '../modules/manifests.js';
import { featureConfig, featureEnabled, getKey, setKey } from './state.js';

export const SUSPEND_ALARM_PREFIX = 'ox-suspend:';
const MODULE = 'tab-suspender';

export interface SuspenderStats {
  discardedNow: number;
  totalSuspended: number;
  estimatedMb: number;
  mbPerTab: number;
}

async function recordSuspended(n: number): Promise<void> {
  if (!n) return;
  const s = await getKey<{ totalSuspended: number }>(STORAGE_KEYS.suspenderStats, { totalSuspended: 0 });
  await setKey(STORAGE_KEYS.suspenderStats, { totalSuspended: (s.totalSuspended ?? 0) + n });
}

/** Discards a tab. The active tab is first swapped for the most recently used other tab. */
export async function suspendTab(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.discarded) return false;
  if (tab.active) {
    const others = (await chrome.tabs.query({ windowId: tab.windowId }))
      .filter((t) => t.id !== tabId)
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    if (!others.length) return false;
    await chrome.tabs.update(others[0].id!, { active: true });
  }
  try {
    const res = await chrome.tabs.discard(tabId);
    if (res) await recordSuspended(1);
    return !!res;
  } catch {
    return false;
  }
}

export async function suspendOthers(windowId: number): Promise<number> {
  const tabs = await chrome.tabs.query({ windowId, active: false, discarded: false });
  let n = 0;
  for (const t of tabs) {
    if (!/^https?:/.test(t.url ?? '')) continue;
    try {
      if (await chrome.tabs.discard(t.id!)) n++;
    } catch {
      /* tab may be gone */
    }
  }
  await recordSuspended(n);
  return n;
}

/** Schedules (or immediately applies) the idle check for one tab. One-shot alarms only, no polling. */
export async function scheduleTab(tab: chrome.tabs.Tab, now = Date.now()): Promise<'suspended' | 'scheduled' | 'skipped'> {
  if (tab.id === undefined) return 'skipped';
  const name = SUSPEND_ALARM_PREFIX + tab.id;
  const cfg = await featureConfig<SuspenderConfig>(MODULE);
  const d = suspendDecision(
    // Only committed URLs: discarding a tab that never finished its first load would lose its URL.
    { ...tab, url: tab.url, audible: tab.audible, lastAccessed: tab.lastAccessed },
    cfg,
    now
  );
  if (d.suspend) {
    await chrome.alarms.clear(name);
    try {
      if (await chrome.tabs.discard(tab.id)) {
        await recordSuspended(1);
        return 'suspended';
      }
    } catch {
      /* ignore */
    }
    return 'skipped';
  }
  if (d.reason === 'not-idle' && d.dueAt) {
    await chrome.alarms.create(name, { when: Math.max(d.dueAt, now + 30_000) });
    return 'scheduled';
  }
  await chrome.alarms.clear(name);
  return 'skipped';
}

export async function clearAllSuspendAlarms(): Promise<void> {
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith(SUSPEND_ALARM_PREFIX)) await chrome.alarms.clear(a.name);
  }
}

/** Re-evaluates every tab (startup, config change). `now` is overridable for tests. */
export async function reconcileSuspender(now = Date.now()): Promise<Record<string, number>> {
  const counts: Record<string, number> = { suspended: 0, scheduled: 0, skipped: 0 };
  if (!(await featureEnabled(MODULE))) {
    await clearAllSuspendAlarms();
    return counts;
  }
  for (const tab of await chrome.tabs.query({})) counts[await scheduleTab(tab, now)]++;
  return counts;
}

export async function onSuspendAlarm(name: string): Promise<void> {
  if (!name.startsWith(SUSPEND_ALARM_PREFIX)) return;
  if (!(await featureEnabled(MODULE))) return;
  const id = Number(name.slice(SUSPEND_ALARM_PREFIX.length));
  try {
    await scheduleTab(await chrome.tabs.get(id));
  } catch {
    /* closed */
  }
}

export async function suspenderStats(): Promise<SuspenderStats> {
  const discardedNow = (await chrome.tabs.query({ discarded: true })).length;
  const s = await getKey<{ totalSuspended: number }>(STORAGE_KEYS.suspenderStats, { totalSuspended: 0 });
  return {
    discardedNow,
    totalSuspended: s.totalSuspended ?? 0,
    estimatedMb: estimateSavedMb(discardedNow),
    mbPerTab: ESTIMATED_MB_PER_DISCARDED_TAB,
  };
}
