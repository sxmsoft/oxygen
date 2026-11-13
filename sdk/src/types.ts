export type OxygenPermission =
  | 'config:read'
  | 'config:write'
  | 'theme:tokens'
  | 'ui:toolbar'
  | 'ui:tabstrip'
  | 'ui:omnibox'
  | 'perf:read'
  | 'storage:local';

export type ModuleCategory = 'core' | 'user';

export interface ConfigSchemaField {
  type: 'boolean' | 'string' | 'number' | 'enum' | 'color';
  label: string;
  description?: string;
  default: boolean | string | number;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export type ConfigSchema = Record<string, ConfigSchemaField>;

export interface OxygenModuleManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: ModuleCategory;
  minOxygenVersion: string;
  permissions: OxygenPermission[];
  dependencies: string[];
  configSchema: ConfigSchema;
  entryPoint: string;
}

export interface ThemeTokens {
  surfacePrimary: string;
  surfaceElevated: string;
  surfaceToolbar: string;
  surfaceOmnibox: string;
  borderSubtle: string;
  textPrimary: string;
  textMuted: string;
  accentColor: string;
  cornerRadiusPx: number;
  motionScale: number;
}

export interface OxygenModuleContext {
  readonly manifest: OxygenModuleManifest;
  getConfig<T = Record<string, unknown>>(): T;
  setConfigValue(key: string, value: unknown): void;
  on<K extends keyof OxygenEventMap>(
    event: K,
    listener: (payload: OxygenEventMap[K]) => void
  ): () => void;
  emit<K extends keyof OxygenEventMap>(event: K, payload: OxygenEventMap[K]): void;
  applyThemeTokens?(tokens: Partial<ThemeTokens>): void;
}

export interface OxygenModuleInstance {
  onEnable(ctx: OxygenModuleContext): void | Promise<void>;
  onConfigChange?(
    nextConfig: Record<string, unknown>,
    ctx: OxygenModuleContext
  ): void | Promise<void>;
  onDisable?(): void | Promise<void>;
}

export interface OxygenEventMap {
  'core:ready': { version: string };
  'module:enabled': { id: string };
  'module:disabled': { id: string };
  'config:updated': { scope: string; data: Record<string, unknown> };
  'theme:tokens-changed': { moduleId: string; tokens: Partial<ThemeTokens> };
  'perf:recorded': { metric: string; durationMs: number };
}

export interface PerfBudgetSnapshot {
  initializedAtMs: number;
  activeModules: number;
  totalRegisteredModules: number;
  lazyLoadTimingsMs: Record<string, number>;
  jsHeapUsedMb: number;
  incrementalBudgetMb: number;
  withinMemoryBudget: boolean;
  backgroundPollingActive: false;
}
