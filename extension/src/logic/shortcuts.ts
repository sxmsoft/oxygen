/**
 * Helium/Chromium new-tab shortcuts ("custom links") and the bookmarks bar.
 *
 * No extension API exposes NTP custom links (chrome.topSites is most-visited
 * only), so `oxygen.sh import-shortcuts` reads a copy of the profile's
 * Preferences (`custom_links.list`) into an import file the extension ingests.
 */

export interface Shortcut {
  title: string;
  url: string;
}

export interface QuickLinkLike extends Shortcut {
  id: string;
  /** where the link came from: 'helium' import, 'topsites' fallback, or user-added (undefined) */
  source?: 'helium' | 'topsites';
  /** user-chosen icon (see linkIcons.ts); kept across re-imports */
  icon?: unknown;
}

export interface ImportFile {
  version: 1;
  source: 'helium-preferences';
  generatedAt: string;
  shortcuts: Shortcut[];
}

function isWeb(url: string): boolean {
  try {
    return /^(https?|ftp|file|chrome|chrome-extension):$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/** Reads `custom_links.list` from a parsed Preferences object, keeping order and titles exactly. */
export function shortcutsFromPreferences(prefs: unknown): Shortcut[] {
  const list = (prefs as { custom_links?: { list?: unknown } } | null)?.custom_links?.list;
  if (!Array.isArray(list)) return [];
  const out: Shortcut[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const { url, title } = raw as { url?: unknown; title?: unknown };
    if (typeof url !== 'string' || !isWeb(url)) continue;
    out.push({ url, title: typeof title === 'string' && title.trim() ? title : fallbackTitle(url) });
  }
  return dedupeShortcuts(out);
}

export function makeImportFile(prefs: unknown, now: Date = new Date()): ImportFile {
  return { version: 1, source: 'helium-preferences', generatedAt: now.toISOString(), shortcuts: shortcutsFromPreferences(prefs) };
}

export function parseImportFile(raw: unknown): ImportFile | null {
  const f = raw as Partial<ImportFile> | null;
  if (!f || f.version !== 1 || !Array.isArray(f.shortcuts)) return null;
  const shortcuts = f.shortcuts.filter(
    (s): s is Shortcut => !!s && typeof s.url === 'string' && typeof s.title === 'string' && isWeb(s.url)
  );
  return { version: 1, source: 'helium-preferences', generatedAt: String(f.generatedAt ?? ''), shortcuts };
}

/** Comparison key only (stored URLs are never rewritten): case-insensitive host, no trailing slash on the path. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}${u.hash}`;
  } catch {
    return url.trim();
  }
}

export function dedupeShortcuts<T extends Shortcut>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = urlKey(s.url);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Stable identity of an import, so the same file is applied only once. */
export function fingerprint(shortcuts: Shortcut[]): string {
  let h = 2166136261;
  for (const c of JSON.stringify(shortcuts.map((s) => [s.title, s.url]))) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/**
 * Imported shortcuts first, in their order and with their titles; then the
 * user's other links (anything not already imported). Earlier imports from the
 * same source that are no longer in Helium are dropped, user-added links never.
 */
export function mergeShortcuts(existing: QuickLinkLike[], imported: Shortcut[], source: 'helium' | 'topsites' = 'helium'): QuickLinkLike[] {
  const icons = new Map(existing.filter((l) => l.icon).map((l) => [urlKey(l.url), l.icon]));
  const head: QuickLinkLike[] = dedupeShortcuts(imported).map((s, i) => ({
    id: `${source}-${i}-${fingerprint([s])}`,
    title: s.title,
    url: s.url,
    source,
    ...(icons.has(urlKey(s.url)) ? { icon: icons.get(urlKey(s.url)) } : {}),
  }));
  const keys = new Set(head.map((s) => urlKey(s.url)));
  const tail = existing.filter((l) => l.source !== source && !keys.has(urlKey(l.url)));
  return [...head, ...tail];
}

// ---------- Bookmarks bar ----------

export interface BookmarkNodeLike {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  folderType?: string;
  children?: BookmarkNodeLike[];
}

export interface BookmarkRoots {
  bar: BookmarkNodeLike | null;
  other: BookmarkNodeLike | null;
  mobile: BookmarkNodeLike | null;
}

/** Finds the bar / "Other" / "Mobile" roots (folderType when present, else Chromium's ids 1, 2, 3). */
export function bookmarkRoots(tree: BookmarkNodeLike[]): BookmarkRoots {
  const tops = tree[0]?.children ?? [];
  const by = (type: string, id: string) => tops.find((n) => n.folderType === type) ?? tops.find((n) => n.id === id) ?? null;
  return { bar: by('bookmarks-bar', '1'), other: by('other', '2'), mobile: by('mobile', '3') };
}

export const ALL_BOOKMARKS_ID = 'oxygen-all-bookmarks';

/**
 * What Helium shows on its bookmarks bar: the bar's children in order, then the
 * "All bookmarks" button (Other bookmarks' children, plus Mobile bookmarks as a
 * folder) when there is anything in it. Nothing is copied: ids are Chrome's.
 */
export function barItems(tree: BookmarkNodeLike[], includeAll = true): BookmarkNodeLike[] {
  const { bar, other, mobile } = bookmarkRoots(tree);
  const items = [...(bar?.children ?? [])];
  const all = [...(other?.children ?? [])];
  if (mobile && (mobile.children?.length ?? 0) > 0) all.push(mobile);
  if (includeAll && all.length > 0) items.push({ id: ALL_BOOKMARKS_ID, title: '', children: all });
  return items;
}
