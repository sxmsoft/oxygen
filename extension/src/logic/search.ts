/** Scores how well `query` matches `text` (0 = no match). Word-prefix and in-order fuzzy matching. */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = (text ?? '').toLowerCase();
  if (!q) return 1;
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return /[\s/._-]/.test(t[idx - 1] ?? ' ') ? 70 : 50;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 40;
  let ti = 0;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti < 0) return 0;
    ti++;
  }
  return 10;
}

export interface Rankable {
  title: string;
  subtitle?: string;
  boost?: number;
}

export function rank<T extends Rankable>(items: T[], query: string, limit = 30): T[] {
  return items
    .map((it, i) => ({
      it,
      i,
      s: Math.max(matchScore(query, it.title), matchScore(query, it.subtitle ?? '') * 0.8) + (it.boost ?? 0),
    }))
    .filter((x) => x.s > (x.it.boost ?? 0))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it);
}
