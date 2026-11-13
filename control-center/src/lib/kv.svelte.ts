import { ingestShortcuts } from '../../../extension/src/features/shortcuts.js';
/** Small reactive wrapper around one chrome.storage.local key (live across tabs and the side panel). */
export class StoredValue<T> {
  value = $state<T>() as T;
  ready = $state(false);
  #key: string;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(key: string, initial: T) {
    this.#key = key;
    this.value = initial;
    if (typeof chrome === 'undefined' || !chrome.storage) {
      this.ready = true;
      return;
    }
    void chrome.storage.local.get(key).then((r) => {
      if (r[key] !== undefined) this.value = r[key] as T;
      this.ready = true;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && key in changes && changes[key].newValue !== undefined) {
        this.value = changes[key].newValue as T;
      }
    });
  }

  /** Writes immediately, or debounced (typing in notes). */
  set(v: T, debounceMs = 0): void {
    this.value = v;
    clearTimeout(this.#timer);
    const write = () => chrome.storage?.local.set({ [this.#key]: $state.snapshot(this.value) });
    if (debounceMs) this.#timer = setTimeout(write, debounceMs);
    else void write();
  }
}

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  /** set for links imported from Helium ('helium') or the most-visited fallback ('topsites') */
  source?: 'helium' | 'topsites';
  /** LinkIcon from linkIcons.ts; missing = site icon */
  icon?: unknown;
}

/**
 * (Re-)imports Helium's new-tab shortcuts right here in the page (not via the
 * service worker, which can be an older cached build); returns a status line.
 */
export async function importFromHelium(t: (k: string, p?: Record<string, string | number>) => string): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.storage) return t('links.importNone');
  const r = await ingestShortcuts(true);
  if (r?.source === 'helium') return t('links.importedHelium', { n: r.count ?? 0 });
  if (r?.source === 'topsites') return t('links.importedTop', { n: r.count ?? 0 });
  return t('links.importNone');
}

export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return /^(https?|ftp|file):$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function favicon(pageUrl: string, size = 32): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return '';
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
