import { OxygenCore } from '../../../oxygen-core/src/OxygenCore.js';
import type { ConfigStorageAdapter } from '../../../oxygen-core/src/ConfigEngine.js';
import type { NativeBridge } from '../../../oxygen-core/src/NativeBridge.js';
import {
  createObsidianThemeModule,
  obsidianThemeManifest,
} from '../../../modules/core-theme-obsidian/src/index.js';
import type { OxygenModuleManifest } from '../../../sdk/src/types.js';
import { FEATURE_MANIFESTS } from '../../../extension/src/modules/manifests.js';

export const perfGuardManifest: OxygenModuleManifest = {
  id: 'core-perf-guard',
  name: 'Performance Guard',
  description: 'Enforces lazy module activation and blocks idle background polling loops.',
  version: '0.1.0',
  author: 'Oxygen Browser Team',
  category: 'core',
  minOxygenVersion: '0.1.0-alpha.1',
  permissions: ['config:read', 'perf:read'],
  dependencies: [],
  entryPoint: 'builtin:perf-guard',
  configSchema: {
    strictLazyLoad: {
      type: 'boolean',
      label: 'Strict Lazy Loading',
      description: 'Defer non-critical UI extensions until their panel is opened.',
      default: true,
    },
    memoryBudgetMb: {
      type: 'number',
      label: 'Incremental Memory Budget (MB)',
      description: 'Warning threshold above base Helium RSS footprint.',
      default: 20,
      min: 10,
      max: 40,
      step: 2,
    },
  },
};

/** Builds an OxygenCore with the built-in core modules registered. */
export function createCore(storage: ConfigStorageAdapter, bridge?: NativeBridge): OxygenCore {
  const core = new OxygenCore({ storage, bridge });
  core.registerModule(obsidianThemeManifest, createObsidianThemeModule, true);
  core.registerModule(
    perfGuardManifest,
    () => ({
      onEnable() {},
      onDisable() {},
    }),
    true
  );
  // Feature modules: their runtime lives in the service worker / pages and reads
  // the same config bundle, so the in-page instance is a no-op handle.
  for (const manifest of FEATURE_MANIFESTS) {
    core.registerModule(manifest, () => ({ onEnable() {}, onDisable() {} }), true);
  }
  return core;
}
