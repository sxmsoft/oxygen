import { hostMatches, hostOf, isWebUrl, parseDomainList } from './domains.js';

export interface SuspenderConfig {
  idleMinutes: number;
  excludePinned: boolean;
  excludeAudible: boolean;
  whitelist: string;
}

export interface SuspendableTab {
  id?: number;
  url?: string;
  pinned: boolean;
  audible?: boolean;
  active: boolean;
  discarded: boolean;
  lastAccessed?: number;
}

export type SkipReason =
  | 'active'
  | 'pinned'
  | 'audible'
  | 'discarded'
  | 'whitelisted'
  | 'unsupported-url'
  | 'not-idle';

export type SuspendDecision =
  | { suspend: true }
  | { suspend: false; reason: SkipReason; dueAt?: number };

/** Rough average memory freed per discarded tab; shown only as an estimate. */
export const ESTIMATED_MB_PER_DISCARDED_TAB = 50;

export function suspendDecision(
  tab: SuspendableTab,
  cfg: SuspenderConfig,
  now: number
): SuspendDecision {
  if (tab.discarded) return { suspend: false, reason: 'discarded' };
  if (!isWebUrl(tab.url)) return { suspend: false, reason: 'unsupported-url' };
  if (tab.active) return { suspend: false, reason: 'active' };
  if (cfg.excludePinned && tab.pinned) return { suspend: false, reason: 'pinned' };
  if (cfg.excludeAudible && tab.audible) return { suspend: false, reason: 'audible' };
  const host = hostOf(tab.url);
  if (host && parseDomainList(cfg.whitelist).some((d) => hostMatches(host, d))) {
    return { suspend: false, reason: 'whitelisted' };
  }
  const minutes = Math.max(1, Number(cfg.idleMinutes) || 1);
  const dueAt = (tab.lastAccessed ?? now) + minutes * 60_000;
  if (now < dueAt) return { suspend: false, reason: 'not-idle', dueAt };
  return { suspend: true };
}

export function estimateSavedMb(discardedCount: number): number {
  return discardedCount * ESTIMATED_MB_PER_DISCARDED_TAB;
}
