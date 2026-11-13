import type { OxygenCore } from '../../../oxygen-core/src/OxygenCore.js';
import { extractSchemaDefaults } from '../../../sdk/src/validator.js';

export function moduleOn(core: OxygenCore, id: string): boolean {
  return core.modules.listModules().find((m) => m.manifest.id === id)?.enabled ?? false;
}

export function moduleCfg<T = Record<string, unknown>>(core: OxygenCore, id: string): T {
  const m = core.modules.listModules().find((x) => x.manifest.id === id);
  return { ...extractSchemaDefaults(m?.manifest.configSchema ?? {}), ...(m?.config ?? {}) } as T;
}
