/**
 * Quick-link icons in IndexedDB ('oxygen-icons'):
 *  - custom: user-uploaded images (resized to 128px PNG), keyed by id
 *  - fetched: sharper site icons (apple-touch-icon etc.) keyed by origin, with
 *    negative caching so a site without one is not refetched on every new tab.
 * Only the site's origin is requested (never the shortcut's path or query).
 */
import { iconCandidates } from '../../../extension/src/logic/linkIcons.js';
import { favicon } from './kv.svelte';

const DB = 'oxygen-icons';
const RETRY_MISS_MS = 7 * 24 * 3600_000;
const REFRESH_HIT_MS = 30 * 24 * 3600_000;
const SIZE = 128;

interface Fetched { origin: string; blob: Blob | null; at: number }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('custom');
      r.result.createObjectStore('fetched', { keyPath: 'origin' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function op<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const req = f(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  });
}

/** Scales an image to fit SIZE×SIZE (centered, transparent) and returns a PNG. */
async function normalize(blob: Blob, min = 1): Promise<Blob | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return null; // not a decodable image (e.g. an HTML error page)
  }
  if (bmp.width < min || bmp.height < min) return null;
  const c = new OffscreenCanvas(SIZE, SIZE);
  const s = Math.min(SIZE / bmp.width, SIZE / bmp.height);
  const w = bmp.width * s, h = bmp.height * s;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return c.convertToBlob({ type: 'image/png' });
}

export async function putCustomIcon(file: Blob): Promise<string> {
  const png = await normalize(file);
  if (!png) throw new Error('unsupported image');
  const id = `ic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await op('custom', 'readwrite', (s) => s.put(png, id));
  return id;
}
export async function deleteCustomIcon(id: string): Promise<void> {
  await op('custom', 'readwrite', (s) => s.delete(id)).catch(() => {});
}

const urls = new Map<string, string>();
function objectUrl(key: string, blob: Blob): string {
  let u = urls.get(key);
  if (!u) urls.set(key, (u = URL.createObjectURL(blob)));
  return u;
}
export async function customIconUrl(id: string): Promise<string | null> {
  const b = await op<Blob | undefined>('custom', 'readonly', (s) => s.get(id)).catch(() => undefined);
  return b ? objectUrl(`c:${id}`, b) : null;
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, credentials: 'omit', redirect: 'follow', cache: 'force-cache' });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const inflight = new Map<string, Promise<string | null>>();
/** results for this page's lifetime (no IndexedDB read per tile re-render) */
const memo = new Map<string, string | null>();
// At most 2 site requests at a time (a new tab with many links must not burst).
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await f();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
/** A sharper icon for the site, or null (cached either way). `force` refetches. */
export function hiResIcon(pageUrl: string, force = false): Promise<string | null> {
  const origin = originOf(pageUrl);
  if (!origin || typeof indexedDB === 'undefined') return Promise.resolve(null);
  const key = `${origin}|${force}`;
  if (!force && memo.has(origin)) return Promise.resolve(memo.get(origin)!);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const hit = await op<Fetched | undefined>('fetched', 'readonly', (s) => s.get(origin)).catch(() => undefined);
      const age = hit ? Date.now() - hit.at : Infinity;
      if (!force && hit && (hit.blob ? age < REFRESH_HIT_MS : age < RETRY_MISS_MS)) return hit.blob ? objectUrl(`f:${origin}`, hit.blob) : null;
      const blob = await slot(async () => {
        const page = await fetchWithTimeout(`${origin}/`);
        const html = page && /html/i.test(page.headers.get('content-type') ?? '') ? (await page.text()).slice(0, 300_000) : '';
        for (const c of iconCandidates(html, page?.url || `${origin}/`).slice(0, 4)) {
          const r = await fetchWithTimeout(c);
          const b = r ? await normalize(await r.blob(), 48) : null;
          if (b) return b;
        }
        return null;
      });
      await op('fetched', 'readwrite', (s) => s.put({ origin, blob, at: Date.now() } satisfies Fetched)).catch(() => {});
      if (blob) {
        const old = urls.get(`f:${origin}`);
        if (old) URL.revokeObjectURL(old), urls.delete(`f:${origin}`);
        return objectUrl(`f:${origin}`, blob);
      }
      return hit?.blob ? objectUrl(`f:${origin}`, hit.blob) : null;
    })()
      .then((u) => (memo.set(origin, u), u))
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Pixels of a favicon URL at 32px (null if it fails to load). */
async function pixels(src: string): Promise<Uint8ClampedArray | null> {
  const r = await fetch(src).catch(() => null);
  if (!r?.ok) return null;
  const bmp = await createImageBitmap(await r.blob()).catch(() => null);
  if (!bmp) return null;
  const c = new OffscreenCanvas(32, 32);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, 32, 32);
  return g.getImageData(0, 0, 32, 32).data;
}
let globe: Promise<Uint8ClampedArray | null> | null = null;
const defaultMemo = new Map<string, Promise<boolean>>();
/** True when the browser has no favicon for this page (it would draw the generic globe). */
export function isDefaultFavicon(pageUrl: string): Promise<boolean> {
  let p = defaultMemo.get(pageUrl);
  if (!p) defaultMemo.set(pageUrl, (p = compareWithGlobe(pageUrl)));
  return p;
}
async function compareWithGlobe(pageUrl: string): Promise<boolean> {
  globe ??= pixels(favicon('https://oxygen-no-such-site.invalid/', 64));
  const [a, b] = await Promise.all([pixels(favicon(pageUrl, 64)), globe]);
  if (!a || !b) return !a;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) return false;
  return true;
}
