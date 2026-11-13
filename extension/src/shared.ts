/** Constants shared by the service worker, the Control Center page and the build scripts. */

export const CONTROL_CENTER_SECTIONS = [
  'dashboard',
  'appearance',
  'modules',
  'performance',
  'advanced',
] as const;
export type SectionId = (typeof CONTROL_CENTER_SECTIONS)[number];

export const THEME_MODULE_ID = 'core-theme-obsidian';
export const THEME_VARIANTS = ['obsidian', 'graphite', 'midnight'] as const;
export type ThemeVariant = (typeof THEME_VARIANTS)[number];

/** Theme packs are matched by name, e.g. "Oxygen Theme Graphite". */
export const THEME_NAME_PREFIX = 'Oxygen Theme ';
export function themeNameFor(variant: ThemeVariant): string {
  return THEME_NAME_PREFIX + variant[0].toUpperCase() + variant.slice(1);
}

export function parseSection(value: string): SectionId | null {
  const v = value.replace(/^#/, '').trim().toLowerCase();
  return (CONTROL_CENTER_SECTIONS as readonly string[]).includes(v) ? (v as SectionId) : null;
}

export function variantFromThemeName(name: string): ThemeVariant | null {
  return THEME_VARIANTS.find((v) => themeNameFor(v) === name) ?? null;
}

/**
 * Written by the service worker after every theme sync.
 * Chromium keeps only the current and the previous theme installed, so not
 * every pack is always available for live switching.
 */
export const THEME_PACK_STATUS_KEY = 'oxygen.theme.pack_status';
export interface ThemePackStatus {
  desired: ThemeVariant | null;
  active: ThemeVariant | null;
  installed: ThemeVariant[];
}

/** Theme pack that was active at the previous browser start (launcher choice). */
export const THEME_LAUNCH_PACK_KEY = 'oxygen.theme.launch_pack';
