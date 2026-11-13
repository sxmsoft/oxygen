/** Normalizes "https://www.Example.com/path" or "*.example.com" to "example.com"-style host patterns. */
export function normalizeHostPattern(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/^\*\./, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  return s.replace(/\.$/, '');
}

export function parseDomainList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map(normalizeHostPattern)
        .filter((d) => d.length > 0)
    ),
  ];
}

/** "example.com" matches example.com and any subdomain. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = normalizeHostPattern(pattern);
  return p.length > 0 && (h === p || h.endsWith('.' + p));
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname || null;
  } catch {
    return null;
  }
}

export function isWebUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}
