<script lang="ts">
  import { i18n } from '../lib/i18n.svelte';
  import { StoredValue } from '../lib/kv.svelte';
  import { exportWorkspaces, parseStore, parseWorkspacesImport, mergeImported, removeWorkspace, tabCount, type Workspace } from '../../../extension/src/logic/workspace.js';
  import { capture } from '../../../extension/src/features/workspaces.js';
  import { makeWorkspace, upsertWorkspace } from '../../../extension/src/logic/workspace.js';

  let { enabled }: { enabled: boolean } = $props();
  const t = i18n.t;
  const raw = new StoredValue<unknown>('oxygen.workspaces', null);
  const store = $derived(parseStore(raw.value));
  let name = $state('');
  let importText = $state('');
  let msg = $state('');
  let exported = $state('');

  async function save(all: boolean) {
    const win = all ? undefined : (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
    const windows = await capture(win);
    if (!windows.length) return;
    raw.set(upsertWorkspace(store, makeWorkspace(name, windows, Date.now())));
    name = '';
  }
  const restore = (id: string) => chrome.runtime.sendMessage({ type: 'workspaces:restore', id });
  function doImport() {
    try {
      const list = parseWorkspacesImport(importText);
      raw.set(mergeImported(store, list));
      msg = t('ws.imported', { n: list.length });
      importText = '';
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
  }
  function download() {
    exported = exportWorkspaces(store.saved);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exported], { type: 'application/json' }));
    a.download = `oxygen-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function rename(w: Workspace, v: string) {
    raw.set({ ...store, saved: store.saved.map((x) => (x.id === w.id ? { ...x, name: v.trim() || x.name } : x)) });
  }
  const last = $derived(store.previousSession ?? store.lastSession);
</script>

<section class="panel-stack" data-testid="cc-workspaces">
  {#if !enabled}<article class="card"><p class="subtitle">{t('common.moduleOff')}</p></article>{/if}
  <article class="card">
    <h2>{t('ws.title')}</h2>
    <p class="subtitle">{t('ws.restoreHint')}</p>
    <div class="ox-row wrap">
      <input class="ox-input grow" placeholder={t('ws.name')} bind:value={name} data-testid="ws-name" />
      <button class="ox-btn primary" onclick={() => save(false)} data-testid="ws-save-window">{t('ws.saveWindow')}</button>
      <button class="ox-btn" onclick={() => save(true)}>{t('ws.saveAll')}</button>
    </div>
    <ul class="wl">
      {#if last}
        <li data-testid="ws-last">
          <div class="nm"><strong>{t('ws.lastSession')}</strong><span class="ox-muted">{t('ws.tabs', { n: tabCount(last) })} · {new Date(last.createdAt).toLocaleString(i18n.locale)}</span></div>
          <button class="ox-btn small" onclick={() => restore('last')}>{t('common.restore')}</button>
        </li>
      {/if}
      {#each store.saved as w (w.id)}
        <li data-testid="ws-item">
          <div class="nm">
            <input class="inline" value={w.name} onchange={(e) => rename(w, (e.target as HTMLInputElement).value)} aria-label={t('ws.name')} />
            <span class="ox-muted">{t('ws.tabs', { n: tabCount(w) })} · {w.windows.length}× ▢ · {w.windows.reduce((n, x) => n + x.groups.length, 0)} ◉</span>
          </div>
          <button class="ox-btn small" onclick={() => restore(w.id)}>{t('common.restore')}</button>
          <button class="ox-btn small ghost danger" onclick={() => raw.set(removeWorkspace(store, w.id))}>{t('common.delete')}</button>
        </li>
      {:else}
        {#if !last}<li class="ox-muted">{t('ws.empty')}</li>{/if}
      {/each}
    </ul>
  </article>
  <article class="card">
    <h2>{t('common.import')} / {t('common.export')}</h2>
    <div class="io">
      <div>
        <button class="ox-btn" onclick={download} disabled={!store.saved.length} data-testid="ws-export">{t('ws.export')}</button>
        {#if exported}<textarea class="ox-textarea" rows="6" readonly value={exported}></textarea>{/if}
      </div>
      <div>
        <textarea class="ox-textarea" rows="6" placeholder={t('ws.importHint')} bind:value={importText} data-testid="ws-import-text"></textarea>
        <button class="ox-btn" onclick={doImport} disabled={!importText.trim()} data-testid="ws-import">{t('ws.import')}</button>
        {#if msg}<p class="subtitle" data-testid="ws-import-msg">{msg}</p>{/if}
      </div>
    </div>
  </article>
</section>

<style>
  .wrap { flex-wrap: wrap; margin: 10px 0 14px; }
  .grow { flex: 1; min-width: 200px; width: auto; }
  .wl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .wl li { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--ox-border); border-radius: var(--ox-radius); }
  .nm { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
  .inline { all: unset; font-weight: 600; font-size: 14px; }
  .inline:focus { border-bottom: 1px solid var(--ox-accent); }
  .io { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .io > div { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .io textarea { width: 100%; }
</style>
