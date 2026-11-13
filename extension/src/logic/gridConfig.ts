/** New tab grid look & feel (stored under oxygen.newtab.grid) and layout presets. */
import type { Layout } from './layout.js';

export type Frame = 'glass' | 'solid' | 'none';

export interface GridConfig {
  columns: number;
  /** 'fixed': rowHeight px; 'fit': `rows` rows fill the window height */
  rowMode: 'fixed' | 'fit';
  rowHeight: number;
  rows: number;
  gap: number;
  /** px; 0 = full width */
  maxWidth: number;
  align: 'center' | 'start' | 'end';
  /** space above the grid, vh */
  topSpace: number;
  frames: Frame;
  showHeader: boolean;
}

export const DEFAULT_GRID: GridConfig = {
  columns: 12,
  rowMode: 'fixed',
  rowHeight: 84,
  rows: 8,
  gap: 14,
  maxWidth: 1240,
  align: 'center',
  topSpace: 6,
  frames: 'glass',
  showHeader: true,
};

export const GRID_LIMITS = {
  columns: [4, 24],
  rowHeight: [40, 160],
  rows: [4, 16],
  gap: [0, 40],
  maxWidth: [0, 2400],
  topSpace: [0, 40],
} as const;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

export function parseGrid(raw: unknown, legacyRowHeight?: number): GridConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GridConfig, unknown>>;
  const d = { ...DEFAULT_GRID, ...(legacyRowHeight ? { rowHeight: legacyRowHeight } : {}) };
  return {
    columns: clamp(r.columns, GRID_LIMITS.columns, d.columns),
    rowMode: oneOf(r.rowMode, ['fixed', 'fit'] as const, d.rowMode),
    rowHeight: clamp(r.rowHeight, GRID_LIMITS.rowHeight, d.rowHeight),
    rows: clamp(r.rows, GRID_LIMITS.rows, d.rows),
    gap: clamp(r.gap, GRID_LIMITS.gap, d.gap),
    maxWidth: r.maxWidth === 0 ? 0 : clamp(r.maxWidth, [480, 2400], d.maxWidth),
    align: oneOf(r.align, ['center', 'start', 'end'] as const, d.align),
    topSpace: clamp(r.topSpace, GRID_LIMITS.topSpace, d.topSpace),
    frames: oneOf(r.frames, ['glass', 'solid', 'none'] as const, d.frames),
    showHeader: r.showHeader === undefined ? d.showHeader : !!r.showHeader,
  };
}

/** Row height in px for the current window ('fit' mode divides the free height into `rows`). */
export function effectiveRowHeight(g: GridConfig, viewportHeight: number, reservedTop: number): number {
  if (g.rowMode === 'fixed') return g.rowHeight;
  const free = Math.max(200, viewportHeight - reservedTop - 32);
  return Math.max(GRID_LIMITS.rowHeight[0], Math.floor((free - g.gap * (g.rows - 1)) / g.rows));
}

/** A widget's frame: its own setting wins over the grid-wide default. */
export function frameOf(settings: Record<string, unknown>, g: GridConfig): Frame {
  return oneOf(settings.frame, ['glass', 'solid', 'none'] as const, g.frames);
}

export interface LayoutPreset {
  id: 'dashboard' | 'minimal' | 'helium';
  grid: Partial<GridConfig>;
  layout: (city: string) => Layout;
}

const links = (s: Record<string, unknown> = {}) => ({ iconSize: 44, shape: 'rounded', showLabels: true, columns: 'auto', align: 'start', ...s });

export const PRESETS: LayoutPreset[] = [
  {
    id: 'dashboard',
    grid: {},
    layout: (city) => [
      { id: 'w-search', type: 'search', x: 2, y: 0, w: 8, h: 1, settings: {} },
      { id: 'w-links', type: 'links', x: 0, y: 1, w: 8, h: 2, settings: links() },
      { id: 'w-clock', type: 'clock', x: 8, y: 1, w: 4, h: 2, settings: { hour24: true, seconds: false, showDate: true } },
      { id: 'w-bookmarks', type: 'bookmarks', x: 0, y: 3, w: 8, h: 2, settings: { showAll: true } },
      { id: 'w-weather', type: 'weather', x: 8, y: 3, w: 4, h: 2, settings: { city, unit: 'celsius' } },
      { id: 'w-workspaces', type: 'workspaces', x: 0, y: 5, w: 4, h: 2, settings: {} },
      { id: 'w-recent', type: 'recent', x: 4, y: 5, w: 4, h: 3, settings: { mode: 'closed' } },
    ],
  },
  {
    id: 'minimal',
    grid: { maxWidth: 820, frames: 'none', topSpace: 16, gap: 10 },
    layout: () => [
      { id: 'w-clock', type: 'clock', x: 3, y: 0, w: 6, h: 2, settings: { hour24: true, seconds: false, showDate: true, frame: 'none' } },
      { id: 'w-search', type: 'search', x: 1, y: 2, w: 10, h: 1, settings: { frame: 'glass' } },
      { id: 'w-links', type: 'links', x: 0, y: 3, w: 12, h: 2, settings: links({ align: 'center', shape: 'circle', iconSize: 40 }) },
    ],
  },
  {
    id: 'helium',
    grid: { maxWidth: 760, frames: 'none', topSpace: 20, gap: 12 },
    layout: () => [
      { id: 'w-search', type: 'search', x: 0, y: 0, w: 12, h: 1, settings: { frame: 'glass' } },
      { id: 'w-links', type: 'links', x: 0, y: 1, w: 12, h: 3, settings: links({ align: 'center', shape: 'circle', iconSize: 48, columns: '5' }) },
    ],
  },
];

export function presetById(id: string): LayoutPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
