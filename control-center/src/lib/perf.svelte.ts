import { DEFAULT_PERF, PERF_KEY, liteMode, parsePerf, type PerfPrefs } from '../../../extension/src/logic/perf.js';
import { StoredValue } from './kv.svelte';

const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

class Perf {
  #store = new StoredValue<unknown>(PERF_KEY, DEFAULT_PERF);
  get prefs(): PerfPrefs {
    return parsePerf(this.#store.value);
  }
  get lite(): boolean {
    return liteMode(this.prefs, deviceMemory);
  }
  get glass(): boolean {
    return this.prefs.glass && !this.lite;
  }
  readonly deviceMemory = deviceMemory;
  set(patch: Partial<PerfPrefs>): void {
    this.#store.set({ ...this.prefs, ...patch });
  }
}
export const perf = new Perf();

/** Keeps <html data-perf="lite|full" data-glass="on|off"> in sync (CSS keys off these). */
export function applyPerfToDocument(root: HTMLElement = document.documentElement): void {
  $effect.root(() => {
    $effect(() => {
      root.dataset.perf = perf.lite ? 'lite' : 'full';
      root.dataset.glass = perf.glass ? 'on' : 'off';
    });
  });
}
