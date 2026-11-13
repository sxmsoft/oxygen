import type { ConfigStorageAdapter, OxygenConfigBundle } from './ConfigEngine.js';

export const OXYGEN_CONFIG_STORAGE_KEY = 'oxygen.config.v1';

/** Subset of `chrome.storage.StorageArea` used by Oxygen. */
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StorageChangeLike {
  newValue?: unknown;
  oldValue?: unknown;
}

export type StorageChangeListener = (
  changes: Record<string, StorageChangeLike>,
  areaName: string
) => void;

/** Subset of `chrome.storage.onChanged`. */
export interface StorageChangeEventLike {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
}

export function isConfigBundle(value: unknown): value is OxygenConfigBundle {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<OxygenConfigBundle>;
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.profileId === 'string' &&
    typeof v.global === 'object' &&
    v.global !== null &&
    typeof v.modules === 'object' &&
    v.modules !== null &&
    Array.isArray(v.enabledModuleIds)
  );
}

/**
 * ConfigStorageAdapter backed by `chrome.storage` (replaces the native
 * `oxygen.*` PrefService prefs of the Chromium fork).
 *
 * ConfigEngine needs synchronous reads, while chrome.storage is async, so the
 * adapter is created with `await ChromeStorageAdapter.create(area)`, which
 * preloads the bundle. Writes update the cache immediately and are flushed to
 * storage in order. Identical bundles are never re-written, which also breaks
 * echo loops between tabs.
 */
export class ChromeStorageAdapter implements ConfigStorageAdapter {
  private cache: OxygenConfigBundle | null;
  private lastSerialized: string | null;
  private pending: Promise<void> = Promise.resolve();
  private lastError: unknown = null;

  private constructor(
    private readonly area: StorageAreaLike,
    private readonly key: string,
    initial: OxygenConfigBundle | null
  ) {
    this.cache = initial ? structuredClone(initial) : null;
    this.lastSerialized = initial ? JSON.stringify(initial) : null;
  }

  static async create(
    area: StorageAreaLike,
    key = OXYGEN_CONFIG_STORAGE_KEY
  ): Promise<ChromeStorageAdapter> {
    const result = await area.get(key);
    const raw = result[key];
    return new ChromeStorageAdapter(area, key, isConfigBundle(raw) ? raw : null);
  }

  read(): OxygenConfigBundle | null {
    return this.cache ? structuredClone(this.cache) : null;
  }

  write(bundle: OxygenConfigBundle): void {
    const serialized = JSON.stringify(bundle);
    if (serialized === this.lastSerialized) return;
    this.cache = structuredClone(bundle);
    this.lastSerialized = serialized;
    const value = JSON.parse(serialized) as OxygenConfigBundle;
    this.pending = this.pending
      .then(() => this.area.set({ [this.key]: value }))
      .catch((err) => {
        this.lastError = err;
      });
  }

  /** Resolves once every queued write reached storage. */
  async flush(): Promise<void> {
    await this.pending;
    if (this.lastError) {
      const err = this.lastError;
      this.lastError = null;
      throw err;
    }
  }

  /**
   * Accepts a bundle written by another context (tab, service worker).
   * Returns the bundle if it differs from the local cache, otherwise null.
   */
  acceptExternal(value: unknown): OxygenConfigBundle | null {
    if (!isConfigBundle(value)) return null;
    const serialized = JSON.stringify(value);
    if (serialized === this.lastSerialized) return null;
    this.cache = structuredClone(value);
    this.lastSerialized = serialized;
    return structuredClone(value);
  }

  /** Subscribes to external changes of the config key in `areaName`. */
  subscribe(
    events: StorageChangeEventLike,
    areaName: string,
    onExternalChange: (bundle: OxygenConfigBundle) => void
  ): () => void {
    const listener: StorageChangeListener = (changes, changedArea) => {
      if (changedArea !== areaName || !(this.key in changes)) return;
      const accepted = this.acceptExternal(changes[this.key].newValue);
      if (accepted) onExternalChange(accepted);
    };
    events.addListener(listener);
    return () => events.removeListener(listener);
  }
}
