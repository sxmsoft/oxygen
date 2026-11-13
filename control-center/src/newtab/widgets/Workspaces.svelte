<script lang="ts">
  import { StoredValue } from '../../lib/kv.svelte';
  import { parseStore, tabCount, type WorkspaceStore } from '../../../../extension/src/logic/workspace.js';
  let { t }: { t: (k: string, p?: Record<string, string | number>) => string } = $props();
  const raw = new StoredValue<unknown>('oxygen.workspaces', null);
  const store = $derived<WorkspaceStore>(parseStore(raw.value));
  const last = $derived(store.previousSession ?? store.lastSession);
  let busy = $state(false);

  async function restore(id: string) {
    await chrome.runtime.sendMessage({ type: 'workspaces:restore', id });
  }
  async function saveWindow() {
    busy = true;
    await chrome.runtime.sendMessage({ type: 'palette:command', id: 'save-workspace' });
    busy = false;
  }
</script>

<div class="ws" data-testid="widget-workspaces">
  <div class="bar"><span class="ox-muted head">{t('w.workspaces')}</span><button class="ox-btn small" disabled={busy} onclick={saveWindow}>＋ {t('ws.saveWindow')}</button></div>
  <ul class="ox-scroll">
    {#if last}
      <li><button onclick={() => restore('last')}><span class="dot last"></span><span class="n">{t('ws.lastSession')}</span><span class="c">{t('ws.tabs', { n: tabCount(last) })}</span></button></li>
    {/if}
    {#each store.saved as w (w.id)}
      <li><button onclick={() => restore(w.id)}><span class="dot"></span><span class="n">{w.name}</span><span class="c">{t('ws.tabs', { n: tabCount(w) })}</span></button></li>
    {/each}
    {#if !last && !store.saved.length}<li class="ox-muted empty">{t('ws.empty')}</li>{/if}
  </ul>
</div>

<style>
  .ws { height: 100%; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-left: 4px; }
  ul { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
  li button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 8px; cursor: pointer; font-size: 13px; }
  li button:hover { background: color-mix(in srgb, var(--ox-text) 7%, transparent); }
  .dot { width: 8px; height: 8px; border-radius: 3px; background: var(--ox-accent); flex: none; }
  .dot.last { background: transparent; border: 1.5px solid var(--ox-accent); }
  .n { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c { color: var(--ox-muted); font-size: 12px; }
  .empty { padding: 6px; font-size: 13px; }
</style>
