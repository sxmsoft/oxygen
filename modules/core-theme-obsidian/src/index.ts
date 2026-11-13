import type {
  OxygenModuleContext,
  OxygenModuleInstance,
  OxygenModuleManifest,
  ThemeTokens,
} from '../../../sdk/src/types.js';
import manifestJson from '../manifest.json' with { type: 'json' };

export const obsidianThemeManifest = manifestJson as OxygenModuleManifest;

export interface ObsidianThemeConfig {
  surfaceContrast: 'obsidian' | 'graphite' | 'midnight';
  accentColor: string;
  cornerRadiusPx: number;
  motionScale: number;
  translucentOmnibox: boolean;
}

const SURFACE_PALETTES: Record<
  ObsidianThemeConfig['surfaceContrast'],
  Pick<
    ThemeTokens,
    'surfacePrimary' | 'surfaceElevated' | 'surfaceToolbar' | 'borderSubtle' | 'textPrimary' | 'textMuted'
  >
> = {
  obsidian: {
    surfacePrimary: '#07080B',
    surfaceElevated: '#101218',
    surfaceToolbar: '#0B0D12',
    borderSubtle: '#222633',
    textPrimary: '#F3F5F8',
    textMuted: '#9AA3B2',
  },
  graphite: {
    surfacePrimary: '#13161C',
    surfaceElevated: '#1C2029',
    surfaceToolbar: '#171B22',
    borderSubtle: '#2E3442',
    textPrimary: '#F5F7FA',
    textMuted: '#A7B0C0',
  },
  midnight: {
    surfacePrimary: '#080C16',
    surfaceElevated: '#111829',
    surfaceToolbar: '#0C1220',
    borderSubtle: '#24314D',
    textPrimary: '#EEF2FA',
    textMuted: '#94A3C4',
  },
};

export function resolveObsidianTokens(cfg: ObsidianThemeConfig): ThemeTokens {
  const palette = SURFACE_PALETTES[cfg.surfaceContrast] ?? SURFACE_PALETTES.obsidian;
  const surfaceOmnibox = cfg.translucentOmnibox
    ? `${palette.surfaceElevated}CC`
    : palette.surfaceElevated;

  return {
    ...palette,
    surfaceOmnibox,
    accentColor: cfg.accentColor,
    cornerRadiusPx: cfg.cornerRadiusPx,
    motionScale: cfg.motionScale,
  };
}

export function createObsidianThemeModule(): OxygenModuleInstance {
  const apply = (ctx: OxygenModuleContext) => {
    const cfg = ctx.getConfig<ObsidianThemeConfig>();
    ctx.applyThemeTokens?.(resolveObsidianTokens(cfg));
  };

  return {
    onEnable(ctx) {
      apply(ctx);
    },
    onConfigChange(_nextConfig, ctx) {
      apply(ctx);
    },
    onDisable() {
      // Native Chromium ColorProvider falls back to Helium grayscale defaults when disabled.
    },
  };
}
