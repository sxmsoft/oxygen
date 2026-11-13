/** Quick-link icons and list editing (pure helpers). */

export type LinkIcon =
  | { kind: 'auto' }
  | { kind: 'image'; id: string }
  | { kind: 'emoji'; text: string; bg: string }
  | { kind: 'letter'; text: string; bg: string };

export interface EditableLink {
  id: string;
  title: string;
  url: string;
  icon?: LinkIcon;
  source?: 'helium' | 'topsites';
}

export const TILE_COLORS = ['#5e81ac', '#bf616a', '#d08770', '#a3be8c', '#b48ead', '#88c0d0', '#ebcb8b', '#4c566a'];

/** Stable color for a site (same site, same color). */
export function colorFor(url: string): string {
  let h = 0;
  for (const c of hostOf(url)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** First letter or digit of the title (or host), uppercase. */
export function letterFor(title: string, url: string): string {
  const src = (title.trim() || hostOf(url)).replace(/^[^\p{L}\p{N}]+/u, '');
  const first = Array.from(src)[0] ?? '?';
  return first.toUpperCase();
}

export function parseIcon(raw: unknown): LinkIcon {
  const r = raw as Partial<LinkIcon & { text: string; bg: string; id: string }> | null;
  if (r?.kind === 'image' && typeof r.id === 'string' && r.id) return { kind: 'image', id: r.id };
  if ((r?.kind === 'emoji' || r?.kind === 'letter') && typeof r.text === 'string' && r.text.trim()) {
    return { kind: r.kind, text: Array.from(r.text.trim()).slice(0, r.kind === 'letter' ? 2 : 4).join(''), bg: /^#[0-9a-f]{6}$/i.test(String(r.bg)) ? String(r.bg) : TILE_COLORS[0] };
  }
  return { kind: 'auto' };
}

export function moveLink<T extends { id: string }>(list: T[], id: string, beforeId: string | null): T[] {
  const item = list.find((l) => l.id === id);
  if (!item || id === beforeId) return list;
  const rest = list.filter((l) => l.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((l) => l.id === beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, item);
  return rest;
}

export function updateLink<T extends EditableLink>(list: T[], id: string, patch: Partial<EditableLink>): T[] {
  return list.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

/**
 * High-resolution icon candidates from a page's HTML: apple-touch-icon and
 * sized <link rel=icon>, largest first, then the conventional
 * /apple-touch-icon.png. SVG counts as large.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const found: { href: string; size: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!/(^|\s)(icon|apple-touch-icon(-precomposed)?|shortcut icon|mask-icon)(\s|$)/.test(rel) || rel.includes('mask-icon')) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']|\bhref\s*=\s*([^\s>]+)/i.exec(tag);
    const h = href?.[1] ?? href?.[2];
    if (!h || h.startsWith('data:')) continue;
    const sizes = /\bsizes\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] ?? '';
    const isSvg = /\.svg(\?|$)/i.test(h) || /image\/svg/i.test(tag);
    const size = isSvg ? 512 : Math.max(0, ...sizes.split(/\s+/).map((s) => Number(s.split('x')[0]) || 0), rel.includes('apple') ? 180 : 0);
    try {
      found.push({ href: new URL(h, pageUrl).toString(), size });
    } catch {
      /* bad href */
    }
  }
  const origin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return '';
    }
  })();
  const ordered = found.sort((a, b) => b.size - a.size).filter((c) => c.size >= 48 || c.size === 0).map((c) => c.href);
  if (origin) ordered.push(`${origin}/apple-touch-icon.png`);
  return [...new Set(ordered)];
}
