import { hostMatches, normalizeHostPattern } from './domains.js';

export interface SiteRule {
  id: string;
  /** host pattern: "example.com" (incl. subdomains), optionally with a path prefix "example.com/docs" */
  pattern: string;
  enabled: boolean;
  zoom?: number | null;
  forceDark?: boolean;
  css?: string;
}

export interface AppliedRules {
  zoom: number | null;
  forceDark: boolean;
  css: string[];
  matched: string[];
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;

/** Filter-based dark mode; media is re-inverted so photos/videos look normal. */
export const DARK_MODE_CSS = `html{filter:invert(.92) hue-rotate(180deg)!important;background:#fff!important}
img,video,picture,canvas,svg image,iframe,embed,object,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}`;

export function normalizePattern(input: string): string {
  let s = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '');
  const slash = s.indexOf('/');
  const host = normalizeHostPattern(slash >= 0 ? s.slice(0, slash) : s);
  const path = slash >= 0 ? s.slice(slash).replace(/\*+$/, '').replace(/\/+$/, '') : '';
  return host + path;
}

export function ruleMatches(rule: SiteRule, url: string): boolean {
  if (!rule.enabled) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const pattern = normalizePattern(rule.pattern);
  const slash = pattern.indexOf('/');
  const host = slash >= 0 ? pattern.slice(0, slash) : pattern;
  const path = slash >= 0 ? pattern.slice(slash) : '';
  if (!hostMatches(u.hostname, host)) return false;
  return !path || u.pathname === path || u.pathname.startsWith(path + '/');
}

export function clampZoom(z: unknown): number | null {
  const n = Number(z);
  if (z === null || z === undefined || z === '' || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 100) / 100));
}

/** Combines all matching rules; the most specific (longest) pattern wins for zoom. */
export function matchRules(rules: SiteRule[], url: string): AppliedRules {
  const matching = rules
    .filter((r) => ruleMatches(r, url))
    .sort((a, b) => normalizePattern(a.pattern).length - normalizePattern(b.pattern).length);
  let zoom: number | null = null;
  let forceDark = false;
  const css: string[] = [];
  for (const r of matching) {
    const z = clampZoom(r.zoom);
    if (z !== null) zoom = z;
    if (r.forceDark) forceDark = true;
    if (r.css?.trim()) css.push(r.css.trim());
  }
  return { zoom, forceDark, css, matched: matching.map((r) => r.id) };
}

export function cssFor(applied: AppliedRules): string {
  return [applied.forceDark ? DARK_MODE_CSS : '', ...applied.css].filter(Boolean).join('\n');
}

export function parseRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === 'object' && typeof (r as SiteRule).pattern === 'string')
    .map((r) => {
      const x = r as SiteRule;
      return {
        id: typeof x.id === 'string' && x.id ? x.id : `rule-${normalizePattern(x.pattern)}`,
        pattern: normalizePattern(x.pattern),
        enabled: x.enabled !== false,
        zoom: clampZoom(x.zoom),
        forceDark: x.forceDark === true,
        css: typeof x.css === 'string' ? x.css.slice(0, 50_000) : '',
      };
    })
    .filter((r) => r.pattern.length > 0);
}

/** Quick toggle: flips forceDark for an exact host rule, creating it if needed. */
export function toggleDarkForHost(rules: SiteRule[], host: string, newId: string): { rules: SiteRule[]; dark: boolean } {
  const pattern = normalizePattern(host);
  const existing = rules.find((r) => normalizePattern(r.pattern) === pattern);
  if (existing) {
    const dark = !(existing.enabled && existing.forceDark);
    return {
      dark,
      rules: rules.map((r) => (r === existing ? { ...r, enabled: true, forceDark: dark } : r)),
    };
  }
  return { dark: true, rules: [...rules, { id: newId, pattern, enabled: true, forceDark: true, zoom: null, css: '' }] };
}
