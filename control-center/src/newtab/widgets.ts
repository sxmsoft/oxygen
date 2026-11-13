import type { Component } from 'svelte';
import type { MessageKey } from '../../../extension/src/logic/i18n.js';
import type { Layout, WidgetSizeDef } from '../../../extension/src/logic/layout.js';
import { PRESETS } from '../../../extension/src/logic/gridConfig.js';

export interface WidgetSetting {
  key: string;
  label: MessageKey;
  type: 'boolean' | 'text' | 'select' | 'range';
  options?: { value: string; label: MessageKey | string }[];
  min?: number;
  max?: number;
  step?: number;
  /** shown after the value of a range ('px') */
  unit?: string;
  default: unknown;
}

export interface WidgetDef extends WidgetSizeDef {
  title: MessageKey;
  icon: string;
  settings: WidgetSetting[];
  /** lazy: a widget's code is only fetched when it is on the grid */
  load: () => Promise<{ default: Component<any> }>;
}

export const WIDGETS: WidgetDef[] = [
  {
    type: 'clock', title: 'w.clock', icon: '◷', defaultW: 4, defaultH: 2, minW: 2, minH: 2, maxH: 4,
    settings: [
      { key: 'hour24', label: 'w.clock.24h', type: 'boolean', default: true },
      { key: 'seconds', label: 'w.clock.seconds', type: 'boolean', default: false },
      { key: 'showDate', label: 'w.clock.date', type: 'boolean', default: true },
    ],
    load: () => import('./widgets/Clock.svelte'),
  },
  {
    type: 'weather', title: 'w.weather', icon: '☀', defaultW: 4, defaultH: 2, minW: 3, minH: 2, maxH: 4,
    settings: [
      { key: 'city', label: 'w.weather.city', type: 'text', default: '' },
      { key: 'unit', label: 'w.weather.unit', type: 'select', default: 'celsius', options: [{ value: 'celsius', label: '°C' }, { value: 'fahrenheit', label: '°F' }] },
    ],
    load: () => import('./widgets/Weather.svelte'),
  },
  {
    type: 'search', title: 'w.search', icon: '⌕', defaultW: 8, defaultH: 1, minW: 4, minH: 1, maxH: 1,
    settings: [],
    load: () => import('./widgets/Search.svelte'),
  },
  {
    type: 'links', title: 'w.links', icon: '⊞', defaultW: 8, defaultH: 2, minW: 2, minH: 1, maxH: 8,
    settings: [
      { key: 'iconSize', label: 'links.iconSize', type: 'range', default: 44, min: 24, max: 96, step: 4, unit: 'px' },
      { key: 'shape', label: 'links.shape', type: 'select', default: 'rounded', options: [{ value: 'rounded', label: 'shape.rounded' }, { value: 'circle', label: 'shape.circle' }, { value: 'square', label: 'shape.square' }] },
      { key: 'showLabels', label: 'links.showLabels', type: 'boolean', default: true },
      { key: 'columns', label: 'links.columns', type: 'select', default: 'auto', options: [{ value: 'auto', label: 'links.columnsAuto' }, ...['3', '4', '5', '6', '7', '8', '10', '12'].map((n) => ({ value: n, label: n }))] },
      { key: 'align', label: 'links.align', type: 'select', default: 'start', options: [{ value: 'start', label: 'grid.alignStart' }, { value: 'center', label: 'grid.alignCenter' }, { value: 'end', label: 'grid.alignEnd' }] },
      { key: 'tile', label: 'links.tile', type: 'select', default: 'plain', options: [{ value: 'plain', label: 'tile.plain' }, { value: 'card', label: 'tile.card' }] },
    ],
    load: () => import('./widgets/Links.svelte'),
  },
  {
    type: 'bookmarks', title: 'w.bookmarks', icon: '★', defaultW: 12, defaultH: 2, minW: 4, minH: 1, maxH: 8,
    settings: [{ key: 'showAll', label: 'w.bookmarks.all', type: 'boolean', default: true }],
    load: () => import('./widgets/Bookmarks.svelte'),
  },
  {
    type: 'recent', title: 'w.recent', icon: '↺', defaultW: 4, defaultH: 3, minW: 3, minH: 2, maxH: 8,
    settings: [
      { key: 'mode', label: 'w.recent.mode', type: 'select', default: 'closed', options: [{ value: 'closed', label: 'w.recent.closed' }, { value: 'visited', label: 'w.recent.visited' }] },
    ],
    load: () => import('./widgets/Recent.svelte'),
  },
  {
    type: 'notes', title: 'w.notes', icon: '✎', defaultW: 4, defaultH: 3, minW: 2, minH: 2, maxH: 8,
    settings: [],
    load: () => import('./widgets/Notes.svelte'),
  },
  {
    type: 'workspaces', title: 'w.workspaces', icon: '▦', defaultW: 4, defaultH: 3, minW: 3, minH: 2, maxH: 8,
    settings: [],
    load: () => import('./widgets/Workspaces.svelte'),
  },
];

export function widgetDef(type: string): WidgetDef | undefined {
  return WIDGETS.find((w) => w.type === type);
}

export function defaultSettings(type: string): Record<string, unknown> {
  return Object.fromEntries((widgetDef(type)?.settings ?? []).map((s) => [s.key, s.default]));
}

/** Widgets added to layouts saved before they existed (once; removing them afterwards sticks). */
export const ADDED_WIDGETS: { type: string; flag: string }[] = [{ type: 'bookmarks', flag: 'oxygen.newtab.added.bookmarks' }];

export const defaultCity = (locale: string) => (locale === 'tr' ? 'İstanbul' : '');

/** The 'dashboard' preset is the default layout. */
export function defaultLayout(locale: string): Layout {
  return PRESETS[0].layout(defaultCity(locale));
}
