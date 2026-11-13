import { STORAGE_KEYS } from '../modules/manifests.js';
import { fingerprint, mergeShortcuts, parseImportFile, type QuickLinkLike, type Shortcut } from '../logic/shortcuts.js';
import { getKey, setKey } from './state.js';

/** Written by `oxygen.sh import-shortcuts` (a copy of Helium's NTP custom links). Not part of packages. */
export const IMPORT_FILE = 'imported-shortcuts.json';

export interface ImportState {
  source: 'helium' | 'topsites';
  fingerprint: string;
  count: number;
  at: number;
}

export interface ImportResult {
  ok: boolean;
  source: 'helium' | 'topsites' | 'none';
  count: number;
  applied: boolean;
}

export async function readImportFile(): Promise<Shortcut[] | null> {
  try {
    const r = await fetch(chrome.runtime.getURL(IMPORT_FILE), { cache: 'no-store' });
    if (!r.ok) return null;
    return parseImportFile(await r.json())?.shortcuts ?? null;
  } catch {
    return null; // no import file in this build
  }
}

async function topSites(): Promise<Shortcut[]> {
  if (!chrome.topSites) return [];
  const sites = await chrome.topSites.get().catch(() => []);
  return sites.filter((s) => /^https?:/.test(s.url)).slice(0, 10).map((s) => ({ title: s.title || s.url, url: s.url }));
}

/**
 * Ingests the Helium import file once per distinct content (startup / install),
 * or again when `force` (the "Import from Helium" button). Without an import
 * file, the first run (or the button) falls back to most-visited sites.
 */
export async function ingestShortcuts(force = false): Promise<ImportResult> {
  const prev = await getKey<ImportState | null>(STORAGE_KEYS.shortcutsImport, null);
  const links = await getKey<QuickLinkLike[]>(STORAGE_KEYS.links, []);
  const file = await readImportFile();
  if (file && file.length > 0) {
    const fp = fingerprint(file);
    if (!force && prev?.source === 'helium' && prev.fingerprint === fp) return { ok: true, source: 'helium', count: file.length, applied: false };
    const merged = mergeShortcuts(links.filter((l) => l.source !== 'topsites'), file, 'helium');
    await setKey(STORAGE_KEYS.links, merged);
    await setKey(STORAGE_KEYS.shortcutsImport, { source: 'helium', fingerprint: fp, count: file.length, at: Date.now() } satisfies ImportState);
    return { ok: true, source: 'helium', count: file.length, applied: true };
  }
  if (!force && (prev || links.length > 0)) return { ok: true, source: 'none', count: 0, applied: false };
  const sites = await topSites();
  if (sites.length > 0) await setKey(STORAGE_KEYS.links, mergeShortcuts(links, sites, 'topsites'));
  await setKey(STORAGE_KEYS.shortcutsImport, { source: 'topsites', fingerprint: fingerprint(sites), count: sites.length, at: Date.now() } satisfies ImportState);
  return { ok: true, source: sites.length ? 'topsites' : 'none', count: sites.length, applied: sites.length > 0 };
}
