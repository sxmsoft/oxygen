import type { OxygenModuleManifest } from '../../../sdk/src/types.js';

/**
 * Feature modules of the Oxygen extension. Each one is a toggleable Oxygen
 * module (Control Center → Modules); the service worker and pages read the same
 * manifests for defaults. All are default-enabled.
 */
const base = {
  version: '0.2.0',
  author: 'Oxygen Browser Team',
  category: 'core' as const,
  minOxygenVersion: '0.1.0-alpha.1',
  dependencies: [] as string[],
};

export const suspenderManifest: OxygenModuleManifest = {
  ...base,
  id: 'tab-suspender',
  name: 'Tab Suspender',
  description: 'Discards idle background tabs to free memory (pinned, audible, active and allow-listed sites are kept).',
  permissions: ['config:read', 'tabs:manage', 'perf:read'],
  entryPoint: 'sw:suspender',
  configSchema: {
    idleMinutes: { type: 'number', label: 'Suspend after (minutes idle)', default: 30, min: 1, max: 720, step: 1 },
    excludePinned: { type: 'boolean', label: 'Keep pinned tabs', default: true },
    excludeAudible: { type: 'boolean', label: 'Keep tabs playing audio', default: true },
    whitelist: { type: 'string', label: 'Never suspend (domains, comma separated)', default: '' },
  },
};

export const workspacesManifest: OxygenModuleManifest = {
  ...base,
  id: 'workspaces',
  name: 'Workspaces & Sessions',
  description: 'Save and restore named sets of windows, tabs and tab groups; autosaves the last session.',
  permissions: ['config:read', 'tabs:manage', 'sessions', 'storage:local'],
  entryPoint: 'sw:workspaces',
  configSchema: {
    autosave: { type: 'boolean', label: 'Autosave last session', default: true },
  },
};

export const paletteManifest: OxygenModuleManifest = {
  ...base,
  id: 'command-palette',
  name: 'Command Palette',
  description: 'Keyboard palette for tabs, history, bookmarks and Oxygen commands.',
  permissions: ['config:read', 'ui:palette', 'tabs:manage'],
  entryPoint: 'content:palette',
  configSchema: {
    includeHistory: { type: 'boolean', label: 'Search history', default: true },
    includeBookmarks: { type: 'boolean', label: 'Search bookmarks', default: true },
  },
};

export const sidePanelManifest: OxygenModuleManifest = {
  ...base,
  id: 'side-panel',
  name: 'Side Panel',
  description: 'Vertical tabs with groups, notes and quick links in the browser side panel.',
  permissions: ['config:read', 'ui:sidepanel', 'tabs:manage', 'storage:local'],
  entryPoint: 'page:sidepanel',
  configSchema: {
    showGroups: { type: 'boolean', label: 'Show tab groups', default: true },
  },
};

export const widgetsManifest: OxygenModuleManifest = {
  ...base,
  id: 'newtab-widgets',
  name: 'New Tab Widgets',
  description: 'Clock, weather, quick links, recent tabs, search, notes and workspaces on a draggable grid.',
  permissions: ['config:read', 'ui:newtab', 'storage:local', 'sessions'],
  entryPoint: 'page:newtab',
  configSchema: {
    rowHeight: { type: 'number', label: 'Grid row height (px)', default: 84, min: 56, max: 140, step: 4 },
  },
};

export const wallpaperManifest: OxygenModuleManifest = {
  ...base,
  id: 'wallpapers',
  name: 'Wallpapers',
  description: 'New tab backgrounds: colors, gradients, your own image or looping video, and light animated scenes.',
  permissions: ['config:read', 'config:write', 'ui:newtab', 'storage:local'],
  entryPoint: 'page:newtab',
  configSchema: {
    kind: {
      type: 'enum',
      label: 'Wallpaper',
      default: 'gradient',
      options: ['none', 'solid', 'gradient', 'image', 'video', 'aurora', 'particles'],
    },
    color1: { type: 'color', label: 'Color 1', default: '#13161C' },
    color2: { type: 'color', label: 'Color 2', default: '#2E3A59' },
    angle: { type: 'number', label: 'Gradient angle', default: 135, min: 0, max: 360, step: 15 },
    blur: { type: 'number', label: 'Blur (px)', default: 0, min: 0, max: 24, step: 1 },
    dim: { type: 'number', label: 'Dim (%)', default: 20, min: 0, max: 80, step: 5 },
  },
};

export const siteRulesManifest: OxygenModuleManifest = {
  ...base,
  id: 'site-rules',
  name: 'Site Rules',
  description: 'Per-site zoom, opt-in forced dark mode and custom CSS.',
  permissions: ['config:read', 'sites:inject', 'storage:local'],
  entryPoint: 'sw:site-rules',
  configSchema: {
    applyZoom: { type: 'boolean', label: 'Apply zoom rules', default: true },
    applyStyles: { type: 'boolean', label: 'Apply dark mode & custom CSS', default: true },
  },
};

export const FEATURE_MANIFESTS: OxygenModuleManifest[] = [
  suspenderManifest,
  workspacesManifest,
  paletteManifest,
  sidePanelManifest,
  widgetsManifest,
  wallpaperManifest,
  siteRulesManifest,
];

export const STORAGE_KEYS = {
  workspaces: 'oxygen.workspaces',
  siteRules: 'oxygen.sites.rules',
  notes: 'oxygen.notes',
  links: 'oxygen.links',
  layout: 'oxygen.newtab.layout',
  suspenderStats: 'oxygen.suspender.stats',
  weatherCache: 'oxygen.weather.cache',
  shortcutsImport: 'oxygen.import.shortcuts',
} as const;
