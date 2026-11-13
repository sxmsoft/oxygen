/** Performance mode: pure decision logic (pages apply it as <html data-perf data-glass>). */
export const PERF_KEY = 'oxygen.perf';

export interface PerfPrefs {
  /** 'auto' = on when the device reports <= 8 GB RAM (navigator.deviceMemory caps at 8) */
  mode: 'auto' | 'on' | 'off';
  /** frosted-glass (backdrop-filter) cards; costly over animated wallpapers */
  glass: boolean;
}
export const DEFAULT_PERF: PerfPrefs = { mode: 'auto', glass: false };

export function parsePerf(raw: unknown): PerfPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PerfPrefs>;
  return {
    mode: r.mode === 'on' || r.mode === 'off' ? r.mode : 'auto',
    glass: r.glass === true,
  };
}

/** True when animations and blur should be off. */
export function liteMode(p: PerfPrefs, deviceMemoryGb: number | undefined): boolean {
  if (p.mode !== 'auto') return p.mode === 'on';
  return (deviceMemoryGb ?? 8) <= 8;
}

/** Frame budget for animated wallpapers. */
export const WALLPAPER_FPS = 30;
/** The aurora drifts over 40-50 s cycles; 15 fps looks the same at half the cost. */
export const AURORA_FPS = 15;
/** No input for this long pauses animated wallpapers. */
export const WALLPAPER_IDLE_MS = 90_000;
