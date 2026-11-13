import {
  extractSchemaDefaults,
  validateConfigAgainstSchema,
} from '../../sdk/src/validator.js';
import type { ConfigSchema } from '../../sdk/src/types.js';
import type { EventBus } from './EventBus.js';

export interface OxygenConfigBundle {
  schemaVersion: number;
  profileId: string;
  global: Record<string, unknown>;
  modules: Record<string, Record<string, unknown>>;
  enabledModuleIds: string[];
}

export type MigrationFn = (bundle: OxygenConfigBundle) => OxygenConfigBundle;

export interface ConfigStorageAdapter {
  read(): OxygenConfigBundle | null;
  write(bundle: OxygenConfigBundle): void;
}

export class MemoryConfigStorage implements ConfigStorageAdapter {
  private snapshot: OxygenConfigBundle | null = null;
  read(): OxygenConfigBundle | null {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }
  write(bundle: OxygenConfigBundle): void {
    this.snapshot = structuredClone(bundle);
  }
}

export const CURRENT_CONFIG_SCHEMA_VERSION = 1;

/**
 * Oxygen Configuration Engine:
 * Manages global settings, per-module configurations, schema validation,
 * version migrations, import/export, and in-memory caching.
 */
export class ConfigEngine {
  private cache: OxygenConfigBundle;
  private readonly schemas = new Map<string, ConfigSchema>();
  private readonly migrations = new Map<number, MigrationFn>();

  constructor(
    private readonly storage: ConfigStorageAdapter,
    private readonly bus: EventBus,
    profileId = 'default'
  ) {
    const existing = storage.read();
    this.cache = existing
      ? this.runMigrations(existing)
      : {
          schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
          profileId,
          global: {
            telemetryEnabled: false,
            lazyInitModules: true,
            upstreamChannel: 'helium-stable',
          },
          modules: {},
          enabledModuleIds: [],
        };
    this.persist();
  }

  registerMigration(fromVersion: number, fn: MigrationFn): void {
    this.migrations.set(fromVersion, fn);
  }

  private runMigrations(bundle: OxygenConfigBundle): OxygenConfigBundle {
    let current = structuredClone(bundle);
    while (current.schemaVersion < CURRENT_CONFIG_SCHEMA_VERSION) {
      const migrate = this.migrations.get(current.schemaVersion);
      if (!migrate) {
        current.schemaVersion += 1;
        continue;
      }
      current = migrate(current);
      current.schemaVersion += 1;
    }
    return current;
  }

  registerModuleSchema(moduleId: string, schema: ConfigSchema): void {
    this.schemas.set(moduleId, schema);
    const defaults = extractSchemaDefaults(schema);
    const current = this.cache.modules[moduleId] ?? {};
    const merged = { ...defaults, ...current };
    const result = validateConfigAgainstSchema(merged, schema);
    if (!result.valid) {
      throw new Error(
        `Invalid persisted config for module "${moduleId}": ${result.errors.join('; ')}`
      );
    }
    this.cache.modules[moduleId] = merged;
    this.persist();
  }

  getGlobal(): Record<string, unknown> {
    return structuredClone(this.cache.global);
  }

  setGlobalValue(key: string, value: unknown): void {
    this.cache.global[key] = value;
    this.persist();
    this.bus.emit('config:updated', {
      scope: 'global',
      data: this.getGlobal(),
    });
  }

  getModuleConfig(moduleId: string): Record<string, unknown> {
    return structuredClone(this.cache.modules[moduleId] ?? {});
  }

  setModuleConfigValue(moduleId: string, key: string, value: unknown): void {
    const schema = this.schemas.get(moduleId);
    const next = { ...(this.cache.modules[moduleId] ?? {}), [key]: value };
    if (schema) {
      const validation = validateConfigAgainstSchema(next, schema);
      if (!validation.valid) {
        throw new Error(validation.errors.join('; '));
      }
    }
    this.cache.modules[moduleId] = next;
    this.persist();
    this.bus.emit('config:updated', {
      scope: `module:${moduleId}`,
      data: structuredClone(next),
    });
  }

  getEnabledModuleIds(): string[] {
    return [...this.cache.enabledModuleIds];
  }

  setModuleEnabled(moduleId: string, enabled: boolean): void {
    const set = new Set(this.cache.enabledModuleIds);
    if (enabled) {
      set.add(moduleId);
    } else {
      set.delete(moduleId);
    }
    this.cache.enabledModuleIds = [...set];
    this.persist();
  }

  exportBundle(): string {
    return JSON.stringify(this.cache, null, 2);
  }

  importBundle(rawJson: string): OxygenConfigBundle {
    const parsed = JSON.parse(rawJson) as OxygenConfigBundle;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.profileId !== 'string') {
      throw new Error('Malformed Oxygen config bundle');
    }
    const migrated = this.runMigrations(parsed);
    for (const [moduleId, schema] of this.schemas.entries()) {
      if (migrated.modules[moduleId]) {
        const res = validateConfigAgainstSchema(migrated.modules[moduleId], schema);
        if (!res.valid) {
          throw new Error(`Invalid imported config for "${moduleId}": ${res.errors.join('; ')}`);
        }
      }
    }
    this.cache = migrated;
    this.persist();
    this.bus.emit('config:updated', { scope: 'import', data: this.getGlobal() });
    return structuredClone(this.cache);
  }

  private persist(): void {
    this.storage.write(this.cache);
  }
}
