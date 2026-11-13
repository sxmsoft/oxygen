<script lang="ts">
  import { onMount } from 'svelte';
  import { OxygenCore, OXYGEN_CORE_VERSION } from '../../oxygen-core/src/OxygenCore.js';
  import {
    createObsidianThemeModule,
    obsidianThemeManifest,
  } from '../../modules/core-theme-obsidian/src/index.js';
  import type {
    OxygenModuleManifest,
    PerfBudgetSnapshot,
    ThemeTokens,
  } from '../../sdk/src/types.js';
  import { BrowserConfigStorage } from './lib/browserStorage';
  import upstreamMeta from '../../UPSTREAM.json';
  import logoSvg from '../../resources/branding/product_logo.svg';

  type SectionId = 'dashboard' | 'appearance' | 'modules' | 'performance' | 'advanced';

  interface ModuleView {
    manifest: OxygenModuleManifest;
    enabled: boolean;
    loaded: boolean;
    config: Record<string, unknown>;
  }

  const core = new OxygenCore({ storage: new BrowserConfigStorage() });

  const perfGuardManifest: OxygenModuleManifest = {
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

  core.registerModule(obsidianThemeManifest, createObsidianThemeModule, true);
  core.registerModule(
    perfGuardManifest,
    () => ({
      onEnable() {},
      onDisable() {},
    }),
    true
  );

  let activeSection = $state<SectionId>('dashboard');
  let selectedModuleId = $state<string>('core-theme-obsidian');
  let modules = $state<ModuleView[]>([]);
  let themeTokens = $state<Partial<ThemeTokens>>({});
  let perf = $state<PerfBudgetSnapshot | null>(null);
  let exportJson = $state('');
  let importJson = $state('');
  let statusBanner = $state('');

  const accentPresets = ['#D8DEE9', '#7DD3FC', '#6EE7B7', '#FCD34D', '#F472B6'];

  function syncView() {
    modules = core.modules.listModules();
    themeTokens = core.getActiveThemeTokens();
    perf = core.getPerformanceSnapshot();
    exportJson = core.config.exportBundle();
  }

  function applyTokensToDocument(tokens: Partial<ThemeTokens>) {
    const root = document.documentElement;
    if (tokens.surfacePrimary) root.style.setProperty('--ox-bg', tokens.surfacePrimary);
    if (tokens.surfaceElevated) root.style.setProperty('--ox-surface', tokens.surfaceElevated);
    if (tokens.surfaceToolbar) root.style.setProperty('--ox-toolbar', tokens.surfaceToolbar);
    if (tokens.surfaceOmnibox) root.style.setProperty('--ox-omnibox', tokens.surfaceOmnibox);
    if (tokens.borderSubtle) root.style.setProperty('--ox-border', tokens.borderSubtle);
    if (tokens.textPrimary) root.style.setProperty('--ox-text', tokens.textPrimary);
    if (tokens.textMuted) root.style.setProperty('--ox-muted', tokens.textMuted);
    if (tokens.accentColor) root.style.setProperty('--ox-accent', tokens.accentColor);
    if (tokens.cornerRadiusPx !== undefined) {
      root.style.setProperty('--ox-radius', `${tokens.cornerRadiusPx}px`);
    }
    if (tokens.motionScale !== undefined) {
      root.style.setProperty('--ox-motion', String(tokens.motionScale));
    }
  }

  onMount(async () => {
    core.bus.on('theme:tokens-changed', ({ tokens }) => {
      applyTokensToDocument(tokens);
    });
    await core.init();
    applyTokensToDocument(core.getActiveThemeTokens());
    syncView();
  });

  async function toggleModule(id: string, currentlyEnabled: boolean) {
    try {
      if (currentlyEnabled) {
        await core.modules.disableModule(id);
        statusBanner = `Disabled module "${id}" (runtime resources released).`;
      } else {
        await core.modules.enableModule(id);
        statusBanner = `Enabled module "${id}".`;
      }
      syncView();
    } catch (err) {
      statusBanner = err instanceof Error ? err.message : String(err);
    }
  }

  async function updateConfig(moduleId: string, key: string, value: unknown) {
    try {
      await core.modules.updateModuleConfig(moduleId, key, value);
      applyTokensToDocument(core.getActiveThemeTokens());
      syncView();
      statusBanner = `Updated ${moduleId}.${key}`;
    } catch (err) {
      statusBanner = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleImport() {
    try {
      core.config.importBundle(importJson);
      await core.modules.initializeEnabledModules();
      applyTokensToDocument(core.getActiveThemeTokens());
      syncView();
      statusBanner = 'Configuration bundle imported and validated successfully.';
    } catch (err) {
      statusBanner = err instanceof Error ? `Import error: ${err.message}` : String(err);
    }
  }

  const themeModule = $derived(modules.find((m) => m.manifest.id === 'core-theme-obsidian'));
  const selectedModule = $derived(
    modules.find((m) => m.manifest.id === selectedModuleId) ?? modules[0]
  );
</script>

<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <img src={logoSvg} alt="Oxygen Logo" class="logo" />
      <div>
        <div class="brand-title">Oxygen</div>
        <div class="brand-sub">Alpha {OXYGEN_CORE_VERSION}</div>
      </div>
    </div>

    <nav class="nav">
      <button
        class:active={activeSection === 'dashboard'}
        onclick={() => (activeSection = 'dashboard')}
      >
        Dashboard
      </button>
      <button
        class:active={activeSection === 'appearance'}
        onclick={() => (activeSection = 'appearance')}
      >
        Appearance & Theme
      </button>
      <button
        class:active={activeSection === 'modules'}
        onclick={() => (activeSection = 'modules')}
      >
        Modules ({modules.filter((m) => m.enabled).length}/{modules.length})
      </button>
      <button
        class:active={activeSection === 'performance'}
        onclick={() => (activeSection = 'performance')}
      >
        Performance
      </button>
      <button
        class:active={activeSection === 'advanced'}
        onclick={() => (activeSection = 'advanced')}
      >
        Config & Upstream
      </button>
    </nav>

    <div class="sidebar-footer">
      <span class="pill">helium {upstreamMeta.helium.chromium_version}</span>
      <span class="pill">{core.bridge.isChromiumWebUI ? 'WebUI Native' : 'Standalone Preview'}</span>
    </div>
  </aside>

  <main class="content">
    <header class="topbar">
      <div>
        <h1>oxygen://settings</h1>
        <p class="subtitle">Oxygen Control Center — Make Your Browser Yours.</p>
      </div>
      {#if statusBanner}
        <div class="banner">{statusBanner}</div>
      {/if}
    </header>

    {#if activeSection === 'dashboard'}
      <section class="grid">
        <article class="card hero">
          <div class="hero-left">
            <img src={logoSvg} alt="Oxygen Emblem" class="hero-logo" />
            <div>
              <h2>Oxygen Browser Alpha 0.1</h2>
              <p>
                Built on Helium ({upstreamMeta.helium.commit.slice(0, 8)}) / Chromium
                {upstreamMeta.helium.chromium_version}. Native modular customization with zero
                background polling.
              </p>
            </div>
          </div>
        </article>

        <article class="card stat">
          <span class="label">Active Modules</span>
          <strong>{perf?.activeModules ?? 0} / {perf?.totalRegisteredModules ?? 0}</strong>
          <span class="hint">Disabled modules never execute</span>
        </article>

        <article class="card stat">
          <span class="label">JS Heap Footprint</span>
          <strong>{perf?.jsHeapUsedMb ?? 0} MB</strong>
          <span class="hint">Target budget &le; {perf?.incrementalBudgetMb ?? 20} MB</span>
        </article>

        <article class="card stat">
          <span class="label">Native Theme</span>
          <strong>{themeModule?.enabled ? 'Obsidian Metallic' : 'Helium Default'}</strong>
          <span class="hint">Accent {themeTokens.accentColor ?? '#D8DEE9'}</span>
        </article>
      </section>
    {/if}

    {#if activeSection === 'appearance' && themeModule}
      <section class="panel-stack">
        <article class="card browser-preview">
          <div class="preview-tabstrip">
            <div class="preview-tab active">
              <img src={logoSvg} alt="" class="mini-icon" />
              <span>Oxygen Control Center</span>
            </div>
            <div class="preview-tab">New Tab</div>
          </div>
          <div class="preview-toolbar">
            <div class="preview-omnibox">oxygen://settings</div>
            <div class="preview-badge">Obsidian Native</div>
          </div>
        </article>

        <article class="card">
          <h2>Obsidian Metallic — Native Theme Controls</h2>
          <div class="form-grid">
            <label class="field">
              <span>Surface Contrast</span>
              <select
                value={String(themeModule.config.surfaceContrast)}
                onchange={(e) =>
                  updateConfig(
                    'core-theme-obsidian',
                    'surfaceContrast',
                    (e.target as HTMLSelectElement).value
                  )}
              >
                <option value="obsidian">Obsidian (#07080B)</option>
                <option value="graphite">Graphite (#13161C)</option>
                <option value="midnight">Midnight (#080C16)</option>
              </select>
            </label>

            <div class="field">
              <span>Accent Color</span>
              <div class="swatch-row">
                {#each accentPresets as preset}
                  <button
                    class="swatch"
                    class:selected={themeModule.config.accentColor === preset}
                    style="background:{preset}"
                    aria-label="Accent {preset}"
                    onclick={() => updateConfig('core-theme-obsidian', 'accentColor', preset)}
                  ></button>
                {/each}
                <input
                  type="color"
                  value={String(themeModule.config.accentColor)}
                  onchange={(e) =>
                    updateConfig(
                      'core-theme-obsidian',
                      'accentColor',
                      (e.target as HTMLInputElement).value
                    )}
                />
              </div>
            </div>

            <label class="field">
              <span>Corner Radius ({themeModule.config.cornerRadiusPx}px)</span>
              <input
                type="range"
                min="0"
                max="16"
                step="1"
                value={Number(themeModule.config.cornerRadiusPx)}
                oninput={(e) =>
                  updateConfig(
                    'core-theme-obsidian',
                    'cornerRadiusPx',
                    Number((e.target as HTMLInputElement).value)
                  )}
              />
            </label>

            <label class="field">
              <span>Animation Scale ({themeModule.config.motionScale}x)</span>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.25"
                value={Number(themeModule.config.motionScale)}
                oninput={(e) =>
                  updateConfig(
                    'core-theme-obsidian',
                    'motionScale',
                    Number((e.target as HTMLInputElement).value)
                  )}
              />
            </label>

            <label class="toggle-field">
              <input
                type="checkbox"
                checked={Boolean(themeModule.config.translucentOmnibox)}
                onchange={(e) =>
                  updateConfig(
                    'core-theme-obsidian',
                    'translucentOmnibox',
                    (e.target as HTMLInputElement).checked
                  )}
              />
              <span>Translucent Omnibox Surface</span>
            </label>
          </div>
        </article>
      </section>
    {/if}

    {#if activeSection === 'modules'}
      <section class="modules-layout">
        <div class="module-list">
          {#each modules as mod}
            <div
              class="card module-item"
              class:selected={selectedModule?.manifest.id === mod.manifest.id}
            >
              <button
                class="module-select"
                onclick={() => (selectedModuleId = mod.manifest.id)}
              >
                <div class="mod-title">
                  <strong>{mod.manifest.name}</strong>
                  <span class="tag">{mod.manifest.category}</span>
                </div>
                <p>{mod.manifest.description}</p>
              </button>
              <button
                class="toggle-btn"
                class:enabled={mod.enabled}
                onclick={() => toggleModule(mod.manifest.id, mod.enabled)}
              >
                {mod.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          {/each}
        </div>

        {#if selectedModule}
          <article class="card module-detail">
            <div class="detail-head">
              <div>
                <h2>{selectedModule.manifest.name}</h2>
                <p class="subtitle">
                  {selectedModule.manifest.id} &middot; v{selectedModule.manifest.version} &middot;
                  by {selectedModule.manifest.author}
                </p>
              </div>
              <span class="pill">{selectedModule.loaded ? 'Loaded' : 'Unloaded'}</span>
            </div>

            <div class="perms">
              {#each selectedModule.manifest.permissions as perm}
                <span class="perm">{perm}</span>
              {/each}
            </div>

            <h3>Module Configuration</h3>
            <div class="form-grid">
              {#each Object.entries(selectedModule.manifest.configSchema) as [key, field]}
                {#if field.type === 'boolean'}
                  <label class="toggle-field">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedModule.config[key])}
                      onchange={(e) =>
                        updateConfig(
                          selectedModule.manifest.id,
                          key,
                          (e.target as HTMLInputElement).checked
                        )}
                    />
                    <span>{field.label}</span>
                  </label>
                {:else if field.type === 'enum'}
                  <label class="field">
                    <span>{field.label}</span>
                    <select
                      value={String(selectedModule.config[key])}
                      onchange={(e) =>
                        updateConfig(
                          selectedModule.manifest.id,
                          key,
                          (e.target as HTMLSelectElement).value
                        )}
                    >
                      {#each field.options ?? [] as opt}
                        <option value={opt}>{opt}</option>
                      {/each}
                    </select>
                  </label>
                {:else if field.type === 'number'}
                  <label class="field">
                    <span>{field.label} ({selectedModule.config[key]})</span>
                    <input
                      type="range"
                      min={field.min ?? 0}
                      max={field.max ?? 100}
                      step={field.step ?? 1}
                      value={Number(selectedModule.config[key])}
                      oninput={(e) =>
                        updateConfig(
                          selectedModule.manifest.id,
                          key,
                          Number((e.target as HTMLInputElement).value)
                        )}
                    />
                  </label>
                {:else}
                  <label class="field">
                    <span>{field.label}</span>
                    <input
                      type={field.type === 'color' ? 'color' : 'text'}
                      value={String(selectedModule.config[key])}
                      onchange={(e) =>
                        updateConfig(
                          selectedModule.manifest.id,
                          key,
                          (e.target as HTMLInputElement).value
                        )}
                    />
                  </label>
                {/if}
              {/each}
            </div>
          </article>
        {/if}
      </section>
    {/if}

    {#if activeSection === 'performance'}
      <section class="panel-stack">
        <article class="card">
          <h2>Oxygen Performance Engine</h2>
          <div class="perf-rows">
            <div><span>Background Polling Loops</span><strong>{perf?.backgroundPollingActive ? 'Active' : 'Disabled (Event-Driven)'}</strong></div>
            <div><span>Runtime Heap Used</span><strong>{perf?.jsHeapUsedMb ?? 0} MB / {perf?.incrementalBudgetMb ?? 20} MB Budget</strong></div>
            <div><span>Budget Compliance</span><strong>{perf?.withinMemoryBudget ? 'PASS' : 'OVER BUDGET'}</strong></div>
          </div>
          {#if perf}
            <h3>Lazy Initialization Timings</h3>
            <div class="perf-rows">
              {#each Object.entries(perf.lazyLoadTimingsMs) as [label, ms]}
                <div><span>{label}</span><strong>{ms} ms</strong></div>
              {/each}
            </div>
          {/if}
        </article>

        <article class="card">
          <h2>Helium vs Oxygen Benchmark Harness</h2>
          <p class="subtitle">
            Run <code>./scripts/oxygen.sh benchmark</code> from the repository root to compare
            RSS/PSS memory, idle CPU %, and startup latency against unmodified Helium.
          </p>
        </article>
      </section>
    {/if}

    {#if activeSection === 'advanced'}
      <section class="panel-stack">
        <article class="card">
          <h2>Upstream Helium Sync Metadata</h2>
          <div class="perf-rows">
            <div><span>Oxygen Version</span><strong>{upstreamMeta.oxygen_version}</strong></div>
            <div><span>Chromium Version</span><strong>{upstreamMeta.helium.chromium_version}</strong></div>
            <div><span>Pinned helium Commit</span><strong>{upstreamMeta.helium.commit}</strong></div>
            <div><span>Pinned helium-linux Commit</span><strong>{upstreamMeta.helium_linux.commit}</strong></div>
          </div>
        </article>

        <article class="card">
          <h2>Configuration Export / Import (Schema Validated)</h2>
          <div class="io-grid">
            <div>
              <label for="export-box">Current Bundle (JSON)</label>
              <textarea id="export-box" readonly value={exportJson} rows="10"></textarea>
            </div>
            <div>
              <label for="import-box">Import Bundle (JSON)</label>
              <textarea
                id="import-box"
                bind:value={importJson}
                placeholder="Paste exported Oxygen JSON bundle here..."
                rows="10"
              ></textarea>
              <button class="primary-btn" onclick={handleImport}>Validate & Import</button>
            </div>
          </div>
        </article>
      </section>
    {/if}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 100vh;
  }

  .sidebar {
    background: var(--ox-toolbar);
    border-right: 1px solid var(--ox-border);
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo {
    width: 40px;
    height: 40px;
    border-radius: 10px;
  }

  .brand-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .brand-sub {
    font-size: 12px;
    color: var(--ox-muted);
  }

  .nav {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .nav button {
    background: transparent;
    color: var(--ox-muted);
    border: 1px solid transparent;
    border-radius: var(--ox-radius);
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    transition: all calc(140ms * var(--ox-motion)) ease;
  }

  .nav button:hover {
    color: var(--ox-text);
    background: var(--ox-surface);
  }

  .nav button.active {
    color: var(--ox-text);
    background: var(--ox-surface);
    border-color: var(--ox-accent);
  }

  .sidebar-footer {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .pill,
  .tag,
  .perm {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid var(--ox-border);
    color: var(--ox-muted);
    background: var(--ox-bg);
  }

  .content {
    padding: 28px 32px;
    max-width: 1120px;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
  }

  h1 {
    margin: 0;
    font-size: 24px;
  }

  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }

  h3 {
    margin: 20px 0 10px;
    font-size: 14px;
    color: var(--ox-muted);
  }

  .subtitle {
    margin: 4px 0 0;
    color: var(--ox-muted);
    font-size: 13px;
  }

  .banner {
    padding: 8px 12px;
    border-radius: var(--ox-radius);
    border: 1px solid var(--ox-accent);
    background: var(--ox-surface);
    font-size: 13px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }

  .card {
    background: var(--ox-surface);
    border: 1px solid var(--ox-border);
    border-radius: var(--ox-radius);
    padding: 18px;
  }

  .hero {
    grid-column: span 3;
  }

  .hero-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .hero-logo {
    width: 60px;
    height: 60px;
    border-radius: 14px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stat .label {
    font-size: 12px;
    color: var(--ox-muted);
  }

  .stat strong {
    font-size: 22px;
    color: var(--ox-accent);
  }

  .stat .hint {
    font-size: 12px;
    color: var(--ox-muted);
  }

  .panel-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .browser-preview {
    padding: 0;
    overflow: hidden;
  }

  .preview-tabstrip {
    background: var(--ox-bg);
    padding: 8px 10px 0;
    display: flex;
    gap: 6px;
  }

  .preview-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    font-size: 12px;
    color: var(--ox-muted);
    border-radius: var(--ox-radius) var(--ox-radius) 0 0;
  }

  .preview-tab.active {
    background: var(--ox-toolbar);
    color: var(--ox-text);
    border: 1px solid var(--ox-border);
    border-bottom: none;
  }

  .mini-icon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }

  .preview-toolbar {
    background: var(--ox-toolbar);
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--ox-border);
  }

  .preview-omnibox {
    flex: 1;
    background: var(--ox-omnibox);
    border: 1px solid var(--ox-border);
    border-radius: var(--ox-radius);
    padding: 6px 12px;
    font-size: 13px;
    color: var(--ox-text);
  }

  .preview-badge {
    font-size: 11px;
    color: var(--ox-bg);
    background: var(--ox-accent);
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 600;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  .field select,
  .field input[type='text'] {
    background: var(--ox-bg);
    color: var(--ox-text);
    border: 1px solid var(--ox-border);
    border-radius: var(--ox-radius);
    padding: 8px 10px;
  }

  .swatch-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 2px solid transparent;
    cursor: pointer;
  }

  .swatch.selected {
    border-color: var(--ox-text);
  }

  .toggle-field {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }

  .modules-layout {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 16px;
  }

  .module-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .module-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .module-item.selected {
    border-color: var(--ox-accent);
  }

  .module-select {
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }

  .module-select p {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--ox-muted);
  }

  .mod-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toggle-btn,
  .primary-btn {
    border: 1px solid var(--ox-border);
    background: var(--ox-bg);
    color: var(--ox-text);
    border-radius: var(--ox-radius);
    padding: 7px 12px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }

  .toggle-btn.enabled,
  .primary-btn {
    background: var(--ox-accent);
    color: #07080b;
    border-color: var(--ox-accent);
  }

  .detail-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .perms {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .perf-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .perf-rows > div {
    display: flex;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--ox-border);
    font-size: 13px;
  }

  .io-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .io-grid textarea {
    width: 100%;
    margin: 8px 0 10px;
    background: var(--ox-bg);
    color: var(--ox-text);
    border: 1px solid var(--ox-border);
    border-radius: var(--ox-radius);
    padding: 10px;
    font-family: monospace;
    font-size: 12px;
  }

  @media (max-width: 900px) {
    .shell,
    .modules-layout,
    .grid,
    .form-grid,
    .io-grid {
      grid-template-columns: 1fr;
    }

    .hero {
      grid-column: span 1;
    }
  }
</style>
