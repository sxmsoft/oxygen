import test from 'node:test';
import assert from 'node:assert/strict';
import { OxygenCore, OXYGEN_CORE_VERSION } from '../src/OxygenCore.js';
import { MemoryConfigStorage } from '../src/ConfigEngine.js';
import type { OxygenModuleManifest } from '../../sdk/src/types.js';
import {
  obsidianThemeManifest,
  createObsidianThemeModule,
} from '../../modules/core-theme-obsidian/src/index.js';

test('OxygenCore initializes enabled modules lazily and keeps disabled modules unexecuted', async () => {
  const core = new OxygenCore();
  let disabledModuleRan = false;

  const userDisabledManifest: OxygenModuleManifest = {
    id: 'user-disabled-mod',
    name: 'Disabled Mod',
    description: 'Should never execute while disabled',
    version: '0.1.0',
    author: 'Tester',
    category: 'user',
    minOxygenVersion: '0.1.0-alpha.1',
    permissions: ['config:read'],
    dependencies: [],
    entryPoint: 'index.ts',
    configSchema: {},
  };

  core.registerModule(obsidianThemeManifest, createObsidianThemeModule, true);
  core.registerModule(
    userDisabledManifest,
    () => {
      disabledModuleRan = true;
      return { onEnable() {} };
    },
    false
  );

  await core.init();

  assert.equal(disabledModuleRan, false);
  assert.equal(core.modules.getActiveCount(), 1);
  assert.equal(core.modules.getTotalCount(), 2);

  const tokens = core.getActiveThemeTokens();
  assert.equal(tokens.surfacePrimary, '#07080B');
  assert.equal(tokens.accentColor, '#D8DEE9');

  const perf = core.getPerformanceSnapshot();
  assert.equal(perf.backgroundPollingActive, false);
  assert.equal(perf.withinMemoryBudget, true);
});

test('ModuleEngine rejects user modules requesting restricted core permissions', () => {
  const core = new OxygenCore();
  const badManifest: OxygenModuleManifest = {
    id: 'bad-user-mod',
    name: 'Bad User Mod',
    description: 'Requests restricted ui:omnibox permission',
    version: '0.1.0',
    author: 'Tester',
    category: 'user',
    minOxygenVersion: '0.1.0-alpha.1',
    permissions: ['ui:omnibox'],
    dependencies: [],
    entryPoint: 'index.ts',
    configSchema: {},
  };

  assert.throws(() => {
    core.registerModule(badManifest, () => ({ onEnable() {} }), true);
  }, /restricted core permission/);
});

test('ConfigEngine validates schemas, migrates versions, and supports export/import', async () => {
  const storage = new MemoryConfigStorage();
  const core = new OxygenCore({ storage });
  core.registerModule(obsidianThemeManifest, createObsidianThemeModule, true);
  await core.init();

  await core.modules.updateModuleConfig('core-theme-obsidian', 'accentColor', '#6EE7B7');
  assert.equal(core.getActiveThemeTokens().accentColor, '#6EE7B7');

  await assert.rejects(
    () => core.modules.updateModuleConfig('core-theme-obsidian', 'accentColor', 'not-a-hex'),
    /hex color/
  );

  const exported = core.config.exportBundle();
  const core2 = new OxygenCore();
  core2.registerModule(obsidianThemeManifest, createObsidianThemeModule, false);
  core2.config.importBundle(exported);
  await core2.init();

  assert.equal(core2.getActiveThemeTokens().accentColor, '#6EE7B7');
  assert.equal(OXYGEN_CORE_VERSION, '0.1.0-alpha.1');
});
