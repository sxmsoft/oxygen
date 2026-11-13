import type { PerfBudgetSnapshot, ThemeTokens } from '../../sdk/src/types.js';
import type { OxygenConfigBundle } from './ConfigEngine.js';
import {
  ConfigEngine,
  MemoryConfigStorage,
  type ConfigStorageAdapter,
} from './ConfigEngine.js';
import { EventBus } from './EventBus.js';
import { ModuleEngine, type ModuleLoader } from './ModuleEngine.js';
import { NoopBridge, type NativeBridge } from './NativeBridge.js';
import { PerformanceEngine } from './PerformanceEngine.js';
import type { OxygenModuleManifest } from '../../sdk/src/types.js';

export const OXYGEN_CORE_VERSION = '0.1.0-alpha.1';

export class OxygenCore {
  readonly bus = new EventBus();
  readonly config: ConfigEngine;
  readonly perf = new PerformanceEngine(this.bus);
  readonly modules: ModuleEngine;
  readonly bridge: NativeBridge;
  private activeThemeTokens: Partial<ThemeTokens> = {};
  private initialized = false;

  constructor(options?: {
    storage?: ConfigStorageAdapter;
    bridge?: NativeBridge;
    profileId?: string;
  }) {
    this.config = new ConfigEngine(
      options?.storage ?? new MemoryConfigStorage(),
      this.bus,
      options?.profileId ?? 'default'
    );
    this.bridge = options?.bridge ?? new NoopBridge();
    this.modules = new ModuleEngine(
      OXYGEN_CORE_VERSION,
      this.config,
      this.bus,
      this.perf,
      (moduleId, tokens) => {
        this.activeThemeTokens = { ...this.activeThemeTokens, ...tokens };
        this.bridge.pushThemeTokens(this.activeThemeTokens);
        this.bus.emit('theme:tokens-changed', { moduleId, tokens: this.activeThemeTokens });
      }
    );
  }

  registerModule(
    manifest: OxygenModuleManifest,
    loader: ModuleLoader,
    defaultEnabled = false
  ): void {
    this.modules.register(manifest, loader, defaultEnabled);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.perf.measureLazyAsync('core:init', async () => {
      await this.modules.initializeEnabledModules();
      this.initialized = true;
      this.bus.emit('core:ready', { version: OXYGEN_CORE_VERSION });
    });
  }

  /**
   * Applies a config bundle written by another context (another tab or the
   * service worker) and brings module state in line with it.
   */
  async applyExternalBundle(bundle: OxygenConfigBundle): Promise<void> {
    this.config.importBundle(JSON.stringify(bundle));
    await this.modules.syncWithConfig();
  }

  getActiveThemeTokens(): Partial<ThemeTokens> {
    return { ...this.activeThemeTokens };
  }

  getPerformanceSnapshot(): PerfBudgetSnapshot {
    return this.perf.getSnapshot(
      this.modules.getActiveCount(),
      this.modules.getTotalCount()
    );
  }

  async dispose(): Promise<void> {
    for (const mod of this.modules.listModules()) {
      if (mod.enabled) {
        await this.modules.disableModule(mod.manifest.id);
      }
    }
    this.bus.clear();
    this.initialized = false;
  }
}
