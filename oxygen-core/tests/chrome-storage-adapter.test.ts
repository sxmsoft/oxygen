import test from 'node:test';
import assert from 'node:assert/strict';
import { OxygenCore } from '../src/OxygenCore.js';
import {
  ChromeStorageAdapter,
  OXYGEN_CONFIG_STORAGE_KEY,
  type StorageAreaLike,
  type StorageChangeEventLike,
  type StorageChangeListener,
} from '../src/ChromeStorageAdapter.js';
import {
  obsidianThemeManifest,
  createObsidianThemeModule,
} from '../../modules/core-theme-obsidian/src/index.js';

/** In-memory stand-in for chrome.storage.local + chrome.storage.onChanged. */
class FakeChromeStorage implements StorageAreaLike {
  data: Record<string, unknown> = {};
  setCalls = 0;
  private readonly listeners = new Set<StorageChangeListener>();
  readonly onChanged: StorageChangeEventLike = {
    addListener: (l) => this.listeners.add(l),
    removeListener: (l) => this.listeners.delete(l),
  };

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (k in this.data) out[k] = structuredClone(this.data[k]);
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls += 1;
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.data[k], newValue: structuredClone(v) };
      this.data[k] = structuredClone(v);
    }
    // Chrome delivers onChanged asynchronously to every context, writer included.
    setTimeout(() => {
      for (const l of [...this.listeners]) l(structuredClone(changes), 'local');
    }, 0);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 10));

async function openCore(area: FakeChromeStorage) {
  const adapter = await ChromeStorageAdapter.create(area);
  const core = new OxygenCore({ storage: adapter });
  core.registerModule(obsidianThemeManifest, createObsidianThemeModule, true);
  await core.init();
  return { adapter, core };
}

test('ChromeStorageAdapter starts empty, then persists defaults to storage', async () => {
  const area = new FakeChromeStorage();
  const { adapter, core } = await openCore(area);
  await adapter.flush();
  const stored = area.data[OXYGEN_CONFIG_STORAGE_KEY] as { enabledModuleIds: string[] };
  assert.deepEqual(stored.enabledModuleIds, ['core-theme-obsidian']);
  assert.equal(core.getActiveThemeTokens().surfacePrimary, '#07080B');
});

test('settings survive a restart (new adapter over the same storage)', async () => {
  const area = new FakeChromeStorage();
  const first = await openCore(area);
  await first.core.modules.updateModuleConfig('core-theme-obsidian', 'accentColor', '#7DD3FC');
  await first.core.modules.updateModuleConfig('core-theme-obsidian', 'surfaceContrast', 'midnight');
  await first.adapter.flush();

  const second = await openCore(area);
  const tokens = second.core.getActiveThemeTokens();
  assert.equal(tokens.accentColor, '#7DD3FC');
  assert.equal(tokens.surfacePrimary, '#080C16');
});

test('identical bundles are not re-written', async () => {
  const area = new FakeChromeStorage();
  const { adapter } = await openCore(area);
  await adapter.flush();
  const before = area.setCalls;
  adapter.write(adapter.read()!);
  await adapter.flush();
  assert.equal(area.setCalls, before);
});

test('key order does not cause re-writes (no echo between tabs)', async () => {
  const area = new FakeChromeStorage();
  const { adapter } = await openCore(area);
  await adapter.flush();
  const before = area.setCalls;
  const b = adapter.read()!;
  const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof b;
  assert.equal(adapter.acceptExternal(reordered), null);
  adapter.write(reordered);
  await adapter.flush();
  assert.equal(area.setCalls, before);
});

test('malformed stored value is ignored and replaced with defaults', async () => {
  const area = new FakeChromeStorage();
  area.data[OXYGEN_CONFIG_STORAGE_KEY] = { nope: true };
  const adapter = await ChromeStorageAdapter.create(area);
  assert.equal(adapter.read(), null);
  const core = new OxygenCore({ storage: adapter });
  await core.init();
  await adapter.flush();
  const stored = area.data[OXYGEN_CONFIG_STORAGE_KEY] as { profileId: string };
  assert.equal(stored.profileId, 'default');
});

test('two tabs stay in sync through storage.onChanged without echo loops', async () => {
  const area = new FakeChromeStorage();
  const tabA = await openCore(area);
  const tabB = await openCore(area);
  let bExternal = 0;
  let aExternal = 0;
  tabA.adapter.subscribe(area.onChanged, 'local', async (b) => {
    aExternal += 1;
    await tabA.core.applyExternalBundle(b);
  });
  tabB.adapter.subscribe(area.onChanged, 'local', async (b) => {
    bExternal += 1;
    await tabB.core.applyExternalBundle(b);
  });
  await settle();
  aExternal = 0;
  bExternal = 0;

  await tabA.core.modules.updateModuleConfig('core-theme-obsidian', 'surfaceContrast', 'graphite');
  await tabA.adapter.flush();
  await settle();
  assert.equal(tabB.core.getActiveThemeTokens().surfacePrimary, '#13161C');
  assert.equal(bExternal, 1);
  assert.equal(aExternal, 0, 'writer must ignore its own change');

  await tabB.core.modules.disableModule('core-theme-obsidian');
  await tabB.adapter.flush();
  await settle();
  assert.equal(tabA.core.modules.getActiveCount(), 0);

  const callsBefore = area.setCalls;
  await settle();
  assert.equal(area.setCalls, callsBefore, 'no further writes after sync settles');
});

test('default-enabled modules all start on; explicit disable survives restart', async () => {
  const area = new FakeChromeStorage();
  const open = async () => {
    const adapter = await ChromeStorageAdapter.create(area);
    const core = new OxygenCore({ storage: adapter });
    core.registerModule(obsidianThemeManifest, createObsidianThemeModule, true);
    core.registerModule(
      { ...obsidianThemeManifest, id: 'core-perf-guard', name: 'Perf', configSchema: {} },
      () => ({ onEnable() {} }),
      true
    );
    await core.init();
    return { adapter, core };
  };
  const first = await open();
  assert.equal(first.core.modules.getActiveCount(), 2);
  await first.core.modules.disableModule('core-theme-obsidian');
  await first.adapter.flush();

  const second = await open();
  assert.equal(second.core.modules.getActiveCount(), 1);
  const stored = area.data[OXYGEN_CONFIG_STORAGE_KEY] as { disabledModuleIds: string[] };
  assert.deepEqual(stored.disabledModuleIds, ['core-theme-obsidian']);
});
