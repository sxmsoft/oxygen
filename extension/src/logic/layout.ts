/** Grid layout engine for new tab widgets (N columns, default 12; vertical compaction). */
export const GRID_COLUMNS = 12;

export interface WidgetPlacement {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: Record<string, unknown>;
}

export interface WidgetSizeDef {
  type: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  maxW?: number;
  maxH?: number;
}

export type Layout = WidgetPlacement[];

export function collides(a: WidgetPlacement, b: WidgetPlacement): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Widget size limits are defined for 12 columns; scale them to the current grid. */
const scaleW = (n: number, cols: number) => Math.max(1, Math.round((n * cols) / GRID_COLUMNS));

function clampSize(p: WidgetPlacement, def?: WidgetSizeDef, cols = GRID_COLUMNS): WidgetPlacement {
  const minW = Math.min(cols, scaleW(def?.minW ?? 1, cols));
  const minH = def?.minH ?? 1;
  const maxW = def?.maxW ? scaleW(def.maxW, cols) : cols;
  const w = Math.min(cols, maxW, Math.max(minW, Math.round(p.w)));
  const h = Math.min(def?.maxH ?? 16, Math.max(minH, Math.round(p.h)));
  const x = Math.min(cols - w, Math.max(0, Math.round(p.x)));
  const y = Math.max(0, Math.round(p.y));
  return { ...p, x, y, w, h };
}

/** Moves every widget up as far as possible without overlaps (stable order). */
export function compact(layout: Layout, pinnedId?: string): Layout {
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: WidgetPlacement[] = [];
  for (const item of sorted) {
    const p = { ...item };
    if (p.id !== pinnedId) {
      while (p.y > 0 && !placed.some((q) => collides({ ...p, y: p.y - 1 }, q))) p.y -= 1;
    }
    while (placed.some((q) => collides(p, q))) p.y += 1;
    placed.push(p);
  }
  return layout.map((orig) => placed.find((p) => p.id === orig.id)!);
}

function placeAndPush(layout: Layout, moved: WidgetPlacement): Layout {
  let next = layout.map((p) => (p.id === moved.id ? moved : p));
  // Push colliding widgets below the moved one, cascading.
  const queue = [moved];
  while (queue.length) {
    const cur = queue.shift()!;
    next = next.map((p) => {
      if (p.id !== moved.id && collides(cur, p)) {
        const pushed = { ...p, y: cur.y + cur.h };
        queue.push(pushed);
        return pushed;
      }
      return p;
    });
  }
  return compact(next);
}

export function moveWidget(layout: Layout, id: string, x: number, y: number, defs: WidgetSizeDef[] = [], cols = GRID_COLUMNS): Layout {
  const item = layout.find((p) => p.id === id);
  if (!item) return layout;
  return placeAndPush(layout, clampSize({ ...item, x, y }, defs.find((d) => d.type === item.type), cols));
}

export function resizeWidget(layout: Layout, id: string, w: number, h: number, defs: WidgetSizeDef[] = [], cols = GRID_COLUMNS): Layout {
  const item = layout.find((p) => p.id === id);
  if (!item) return layout;
  return placeAndPush(layout, clampSize({ ...item, w, h }, defs.find((d) => d.type === item.type), cols));
}

export function findFreeSpot(layout: Layout, w: number, h: number, cols = GRID_COLUMNS): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const probe = { id: '__probe__', type: '', x, y, w, h, settings: {} };
      if (!layout.some((p) => collides(probe, p))) return { x, y };
    }
  }
}

export function addWidget(
  layout: Layout,
  type: string,
  defs: WidgetSizeDef[],
  id: string,
  settings: Record<string, unknown> = {},
  cols = GRID_COLUMNS
): Layout {
  const def = defs.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown widget type "${type}"`);
  const w = Math.min(cols, scaleW(def.defaultW, cols));
  const spot = findFreeSpot(layout, w, def.defaultH, cols);
  return [...layout, { id, type, x: spot.x, y: spot.y, w, h: def.defaultH, settings }];
}

export function removeWidget(layout: Layout, id: string): Layout {
  return compact(layout.filter((p) => p.id !== id));
}

export function updateWidgetSettings(layout: Layout, id: string, settings: Record<string, unknown>): Layout {
  return layout.map((p) => (p.id === id ? { ...p, settings: { ...p.settings, ...settings } } : p));
}

/** Validates persisted layout data; unknown widget types are dropped, sizes clamped, overlaps resolved. */
export function parseLayout(raw: unknown, defs: WidgetSizeDef[], cols = GRID_COLUMNS): Layout | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: Layout = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const p = r as Partial<WidgetPlacement>;
    const def = defs.find((d) => d.type === p.type);
    if (!def || typeof p.id !== 'string' || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(
      clampSize(
        {
          id: p.id,
          type: def.type,
          x: Number(p.x) || 0,
          y: Number(p.y) || 0,
          w: Number(p.w) || def.defaultW,
          h: Number(p.h) || def.defaultH,
          settings: p.settings && typeof p.settings === 'object' ? { ...p.settings } : {},
        },
        def,
        cols
      )
    );
  }
  return compact(out);
}

/** Changing the column count keeps each widget's relative position and width. */
export function rescaleLayout(layout: Layout, fromCols: number, toCols: number, defs: WidgetSizeDef[] = []): Layout {
  if (fromCols === toCols) return layout;
  const f = toCols / fromCols;
  return compact(
    layout.map((p) => clampSize({ ...p, x: Math.round(p.x * f), w: Math.max(1, Math.round(p.w * f)) }, defs.find((d) => d.type === p.type), toCols))
  );
}

export function layoutHeight(layout: Layout): number {
  return layout.reduce((m, p) => Math.max(m, p.y + p.h), 0);
}
