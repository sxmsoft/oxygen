import type {
  ConfigSchema,
  OxygenModuleManifest,
  OxygenPermission,
} from './types.js';

const USER_ALLOWED_PERMISSIONS = new Set<OxygenPermission>([
  'config:read',
  'config:write',
  'theme:tokens',
  'ui:toolbar',
  'ui:tabstrip',
  'perf:read',
  'storage:local',
]);

const CORE_ONLY_PERMISSIONS = new Set<OxygenPermission>([
  'ui:omnibox',
  'tabs:manage',
  'sessions',
  'sites:inject',
  'ui:newtab',
  'ui:sidepanel',
  'ui:palette',
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z0-9.-]+)?$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function parseSemver(version: string): [number, number, number] | null {
  const m = SEMVER_PATTERN.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    throw new Error(`Invalid semver comparison: "${a}" vs "${b}"`);
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function satisfiesMinVersion(current: string, minimum: string): boolean {
  return compareSemver(current, minimum) >= 0;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifest(
  manifest: OxygenModuleManifest,
  currentOxygenVersion: string
): ValidationResult {
  const errors: string[] = [];

  if (!ID_PATTERN.test(manifest.id)) {
    errors.push(`Invalid module id "${manifest.id}" (must match ${ID_PATTERN})`);
  }
  if (!manifest.name?.trim()) {
    errors.push('Module name is required');
  }
  if (!manifest.description?.trim()) {
    errors.push('Module description is required');
  }
  if (!parseSemver(manifest.version)) {
    errors.push(`Invalid module version "${manifest.version}"`);
  }
  if (!manifest.author?.trim()) {
    errors.push('Module author is required');
  }
  if (!parseSemver(manifest.minOxygenVersion)) {
    errors.push(`Invalid minOxygenVersion "${manifest.minOxygenVersion}"`);
  } else if (!satisfiesMinVersion(currentOxygenVersion, manifest.minOxygenVersion)) {
    errors.push(
      `Module requires Oxygen >= ${manifest.minOxygenVersion} (current: ${currentOxygenVersion})`
    );
  }
  if (!manifest.entryPoint?.trim()) {
    errors.push('Module entryPoint is required');
  }
  if (!Array.isArray(manifest.dependencies)) {
    errors.push('Module dependencies must be an array');
  }

  for (const perm of manifest.permissions ?? []) {
    const known = USER_ALLOWED_PERMISSIONS.has(perm) || CORE_ONLY_PERMISSIONS.has(perm);
    if (!known) {
      errors.push(`Unknown permission "${perm}"`);
    } else if (manifest.category === 'user' && CORE_ONLY_PERMISSIONS.has(perm)) {
      errors.push(`User modules cannot request restricted core permission "${perm}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function extractSchemaDefaults(schema: ConfigSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    out[key] = field.default;
  }
  return out;
}

export function validateConfigAgainstSchema(
  config: Record<string, unknown>,
  schema: ConfigSchema
): ValidationResult {
  const errors: string[] = [];

  for (const [key, field] of Object.entries(schema)) {
    if (!(key in config)) continue;
    const value = config[key];
    switch (field.type) {
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Config "${key}" must be boolean`);
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`Config "${key}" must be string`);
        }
        break;
      case 'color':
        if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
          errors.push(`Config "${key}" must be a 6-digit hex color (#RRGGBB)`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`Config "${key}" must be number`);
        } else {
          if (field.min !== undefined && value < field.min) {
            errors.push(`Config "${key}" must be >= ${field.min}`);
          }
          if (field.max !== undefined && value > field.max) {
            errors.push(`Config "${key}" must be <= ${field.max}`);
          }
        }
        break;
      case 'enum':
        if (typeof value !== 'string' || !field.options?.includes(value)) {
          errors.push(
            `Config "${key}" must be one of [${(field.options ?? []).join(', ')}]`
          );
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}
