import type { OxygenConfigBundle } from '../../../oxygen-core/src/ConfigEngine.js';
import type { ConfigSchema } from '../../../sdk/src/types.js';
import { extractSchemaDefaults } from '../../../sdk/src/validator.js';

/** Same rule as ModuleEngine.register(): default-enabled modules are on unless explicitly disabled. */
export function isModuleEnabled(
  bundle: OxygenConfigBundle | null | undefined,
  id: string,
  defaultEnabled: boolean
): boolean {
  if (!bundle) return defaultEnabled;
  if (bundle.enabledModuleIds.includes(id)) return true;
  if ((bundle.disabledModuleIds ?? []).includes(id)) return false;
  return defaultEnabled;
}

export function moduleConfig<T>(
  bundle: OxygenConfigBundle | null | undefined,
  id: string,
  schema: ConfigSchema
): T {
  return { ...extractSchemaDefaults(schema), ...(bundle?.modules[id] ?? {}) } as T;
}
