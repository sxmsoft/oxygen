import type {
  OxygenModuleContext,
  OxygenModuleInstance,
  OxygenModuleManifest,
  OxygenPermission,
  ThemeTokens,
} from '../../sdk/src/types.js';
import { validateManifest } from '../../sdk/src/validator.js';
import type { ConfigEngine } from './ConfigEngine.js';
import type { EventBus } from './EventBus.js';
import type { PerformanceEngine } from './PerformanceEngine.js';

export type ModuleLoader = () => OxygenModuleInstance | Promise<OxygenModuleInstance>;

export interface RegisteredModule {
  manifest: OxygenModuleManifest;
  loader: ModuleLoader;
  enabled: boolean;
  instance: OxygenModuleInstance | null;
  cleanups: Array<() => void>;
}

/**
 * Oxygen Module Engine:
 * Manages Core Modules and restricted User Modules with strict permission
 * checks, dependency enforcement, lazy loading, and zero-execution for
 * disabled modules.
 */
export class ModuleEngine {
  private readonly registry = new Map<string, RegisteredModule>();

  constructor(
    private readonly oxygenVersion: string,
    private readonly config: ConfigEngine,
    private readonly bus: EventBus,
    private readonly perf: PerformanceEngine,
    private readonly onApplyThemeTokens: (
      moduleId: string,
      tokens: Partial<ThemeTokens>
    ) => void
  ) {}

  register(manifest: OxygenModuleManifest, loader: ModuleLoader, defaultEnabled = false): void {
    const check = validateManifest(manifest, this.oxygenVersion);
    if (!check.valid) {
      throw new Error(
        `Manifest validation failed for "${manifest.id}": ${check.errors.join('; ')}`
      );
    }
    if (this.registry.has(manifest.id)) {
      throw new Error(`Module "${manifest.id}" is already registered`);
    }

    this.config.registerModuleSchema(manifest.id, manifest.configSchema);
    const persisted = this.config.getEnabledModuleIds();
    const shouldEnable =
      persisted.includes(manifest.id) || (persisted.length === 0 && defaultEnabled);
    if (shouldEnable && !persisted.includes(manifest.id)) {
      this.config.setModuleEnabled(manifest.id, true);
    }

    this.registry.set(manifest.id, {
      manifest,
      loader,
      enabled: shouldEnable,
      instance: null,
      cleanups: [],
    });
  }

  async initializeEnabledModules(): Promise<void> {
    const persisted = new Set(this.config.getEnabledModuleIds());
    for (const [id, entry] of this.registry.entries()) {
      if (persisted.has(id)) {
        entry.enabled = true;
      }
      if (entry.enabled && !entry.instance) {
        await this.activateEntry(id, entry);
      }
    }
  }

  async enableModule(moduleId: string): Promise<void> {
    const entry = this.requireEntry(moduleId);
    if (entry.enabled && entry.instance) return;

    for (const depId of entry.manifest.dependencies) {
      const dep = this.registry.get(depId);
      if (!dep) {
        throw new Error(`Missing dependency "${depId}" required by "${moduleId}"`);
      }
      if (!dep.enabled || !dep.instance) {
        await this.enableModule(depId);
      }
    }

    entry.enabled = true;
    this.config.setModuleEnabled(moduleId, true);
    await this.activateEntry(moduleId, entry);
  }

  async disableModule(moduleId: string): Promise<void> {
    const entry = this.requireEntry(moduleId);
    if (!entry.enabled && !entry.instance) return;

    // Disable dependents first so dependency invariants always hold
    for (const [otherId, other] of this.registry.entries()) {
      if (other.enabled && other.manifest.dependencies.includes(moduleId)) {
        await this.disableModule(otherId);
      }
    }

    if (entry.instance?.onDisable) {
      await entry.instance.onDisable();
    }
    for (const cleanup of entry.cleanups) {
      cleanup();
    }
    entry.cleanups = [];
    entry.instance = null;
    entry.enabled = false;
    this.config.setModuleEnabled(moduleId, false);
    this.bus.emit('module:disabled', { id: moduleId });
  }

  async updateModuleConfig(moduleId: string, key: string, value: unknown): Promise<void> {
    const entry = this.requireEntry(moduleId);
    this.config.setModuleConfigValue(moduleId, key, value);
    if (entry.enabled && entry.instance?.onConfigChange) {
      const ctx = this.createRestrictedContext(entry);
      await entry.instance.onConfigChange(this.config.getModuleConfig(moduleId), ctx);
    }
  }

  listModules(): Array<{
    manifest: OxygenModuleManifest;
    enabled: boolean;
    loaded: boolean;
    config: Record<string, unknown>;
  }> {
    return [...this.registry.values()].map((entry) => ({
      manifest: entry.manifest,
      enabled: entry.enabled,
      loaded: entry.instance !== null,
      config: this.config.getModuleConfig(entry.manifest.id),
    }));
  }

  getActiveCount(): number {
    let count = 0;
    for (const entry of this.registry.values()) {
      if (entry.enabled && entry.instance) count += 1;
    }
    return count;
  }

  getTotalCount(): number {
    return this.registry.size;
  }

  private async activateEntry(moduleId: string, entry: RegisteredModule): Promise<void> {
    await this.perf.measureLazyAsync(`module:${moduleId}`, async () => {
      const instance = await entry.loader();
      const ctx = this.createRestrictedContext(entry);
      await instance.onEnable(ctx);
      entry.instance = instance;
      this.bus.emit('module:enabled', { id: moduleId });
    });
  }

  private requireEntry(moduleId: string): RegisteredModule {
    const entry = this.registry.get(moduleId);
    if (!entry) {
      throw new Error(`Unknown Oxygen module "${moduleId}"`);
    }
    return entry;
  }

  private createRestrictedContext(entry: RegisteredModule): OxygenModuleContext {
    const perms = new Set<OxygenPermission>(entry.manifest.permissions);
    const id = entry.manifest.id;

    const assertPerm = (perm: OxygenPermission) => {
      if (!perms.has(perm)) {
        throw new Error(`Module "${id}" lacks required permission "${perm}"`);
      }
    };

    const ctx: OxygenModuleContext = {
      manifest: entry.manifest,
      getConfig: <T = Record<string, unknown>>() => {
        assertPerm('config:read');
        return this.config.getModuleConfig(id) as T;
      },
      setConfigValue: (key: string, value: unknown) => {
        assertPerm('config:write');
        this.config.setModuleConfigValue(id, key, value);
      },
      on: (event, listener) => {
        const unsub = this.bus.on(event, listener);
        entry.cleanups.push(unsub);
        return unsub;
      },
      emit: (event, payload) => {
        this.bus.emit(event, payload);
      },
    };

    if (perms.has('theme:tokens')) {
      ctx.applyThemeTokens = (tokens) => {
        this.onApplyThemeTokens(id, tokens);
      };
    }

    return ctx;
  }
}
