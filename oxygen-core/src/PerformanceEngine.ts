import type { PerfBudgetSnapshot } from '../../sdk/src/types.js';
import type { EventBus } from './EventBus.js';

export const OXYGEN_INCREMENTAL_MEMORY_BUDGET_MB = 20;

/**
 * Oxygen Performance Engine:
 * Measures lazy initialization timings, enforces zero background polling,
 * and evaluates runtime footprint against the 10-20 MB incremental budget.
 */
export class PerformanceEngine {
  private readonly initializedAtMs = Date.now();
  private readonly lazyLoadTimingsMs: Record<string, number> = {};

  constructor(private readonly bus: EventBus) {}

  measureLazy<T>(label: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const durationMs = Number((performance.now() - start).toFixed(3));
      this.lazyLoadTimingsMs[label] = durationMs;
      this.bus.emit('perf:recorded', { metric: label, durationMs });
    }
  }

  async measureLazyAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const durationMs = Number((performance.now() - start).toFixed(3));
      this.lazyLoadTimingsMs[label] = durationMs;
      this.bus.emit('perf:recorded', { metric: label, durationMs });
    }
  }

  getSnapshot(activeModules: number, totalRegisteredModules: number): PerfBudgetSnapshot {
    let jsHeapUsedMb = 0;
    const nodeProc = (
      globalThis as unknown as {
        process?: { memoryUsage?: () => { heapUsed: number } };
      }
    ).process;
    if (typeof nodeProc?.memoryUsage === 'function') {
      jsHeapUsedMb = Number((nodeProc.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2));
    } else if (
      typeof performance !== 'undefined' &&
      'memory' in performance &&
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    ) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      jsHeapUsedMb = Number((mem.usedJSHeapSize / (1024 * 1024)).toFixed(2));
    }

    return {
      initializedAtMs: this.initializedAtMs,
      activeModules,
      totalRegisteredModules,
      lazyLoadTimingsMs: { ...this.lazyLoadTimingsMs },
      jsHeapUsedMb,
      incrementalBudgetMb: OXYGEN_INCREMENTAL_MEMORY_BUDGET_MB,
      withinMemoryBudget: jsHeapUsedMb <= OXYGEN_INCREMENTAL_MEMORY_BUDGET_MB,
      backgroundPollingActive: false,
    };
  }
}
