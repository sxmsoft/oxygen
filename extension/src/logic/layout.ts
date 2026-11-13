/** Grid layout engine for new tab widgets (12 columns, vertical compaction). */
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

function clampSize(p: WidgetPlacement, def?: WidgetSizeDef): WidgetPlacement {
  const minW = def?.minW ?? 1;
  const minH = def?.minH ?? 1;
  const w = Math.min(GRID_COLUMNS, def?.maxW ?? GRID_COLUMNS, Math.max(minW, Math.round(p.w)));
  const h = Math.min(def?.maxH ?? 12, Math.max(minH, Math.round(p.h)));
  const x = Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(p.x)));
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

export function moveWidget(layout: Layout, id: string, x: number, y: number, defs: WidgetSizeDef[] = []): Layout {
  const item = layout.find((p) => p.id === id);
  if (!item) return layout;
  return placeAndPush(layout, clampSize({ ...item, x, y }, defs.find((d) => d.type === item.type)));
}

export function resizeWidget(layout: Layout, id: string, w: number, h: number, defs: WidgetSizeDef[] = []): Layout {
  const item = layout.find((p) => p.id === id);
  if (!item) return layout;
  return placeAndPush(layout, clampSize({ ...item, w, h }, defs.find((d) => d.type === item.type)));
}

export function findFreeSpot(layout: Layout, w: number, h: number): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x <= GRID_COLUMNS - w; x++) {
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
  settings: Record<string, unknown> = {}
): Layout {
  const def = defs.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown widget type "${type}"`);
  const w = Math.min(GRID_COLUMNS, def.defaultW);
  const spot = findFreeSpot(layout, w, def.defaultH);
  return [...layout, { id, type, x: spot.x, y: spot.y, w, h: def.defaultH, settings }];
}

export function removeWidget(layout: Layout, id: string): Layout {
  return compact(layout.filter((p) => p.id !== id));
}

export function updateWidgetSettings(layout: Layout, id: string, settings: Record<string, unknown>): Layout {
  return layout.map((p) => (p.id === id ? { ...p, settings: { ...p.settings, ...settings } } : p));
}

/** Validates persisted layout data; unknown widget types are dropped, sizes clamped, overlaps resolved. */
export function parseLayout(raw: unknown, defs: WidgetSizeDef[]): Layout | null {
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
        def
      )
    );
  }
  return compact(out);
}

export function layoutHeight(layout: Layout): number {
  return layout.reduce((m, p) => Math.max(m, p.y + p.h), 0);
}
