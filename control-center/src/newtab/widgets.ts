import type { Component } from 'svelte';
import type { MessageKey } from '../../../extension/src/logic/i18n.js';
import type { Layout, WidgetSizeDef } from '../../../extension/src/logic/layout.js';

export interface WidgetSetting {
  key: string;
  label: MessageKey;
  type: 'boolean' | 'text' | 'select';
  options?: { value: string; label: MessageKey | string }[];
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
    type: 'links', title: 'w.links', icon: '⊞', defaultW: 8, defaultH: 2, minW: 3, minH: 2, maxH: 6,
    settings: [],
    load: () => import('./widgets/Links.svelte'),
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

export function defaultLayout(locale: string): Layout {
  const city = locale === 'tr' ? 'İstanbul' : '';
  return [
    { id: 'w-search', type: 'search', x: 2, y: 0, w: 8, h: 1, settings: {} },
    { id: 'w-clock', type: 'clock', x: 0, y: 1, w: 4, h: 2, settings: defaultSettings('clock') },
    { id: 'w-weather', type: 'weather', x: 4, y: 1, w: 4, h: 2, settings: { ...defaultSettings('weather'), city } },
    { id: 'w-workspaces', type: 'workspaces', x: 8, y: 1, w: 4, h: 2, settings: {} },
    { id: 'w-links', type: 'links', x: 0, y: 3, w: 8, h: 2, settings: {} },
    { id: 'w-recent', type: 'recent', x: 8, y: 3, w: 4, h: 3, settings: defaultSettings('recent') },
  ];
}
