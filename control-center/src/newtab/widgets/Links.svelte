<script lang="ts">
  import { onMount } from 'svelte';
  import { ingestShortcuts } from '../../../../extension/src/features/shortcuts.js';
  import { StoredValue, favicon, hostLabel, importFromHelium, normalizeUrl, type QuickLink } from '../../lib/kv.svelte';
  let { t, editing }: { t: (k: string, p?: Record<string, string | number>) => string; editing: boolean } = $props();
  let status = $state('');
  // Picks up a new Helium import even when the service worker missed it (applied once per content).
  onMount(() => void ingestShortcuts(false).catch(() => {}));
  async function doImport() {
    status = await importFromHelium(t);
  }
  const links = new StoredValue<QuickLink[]>('oxygen.links', []);
  let adding = $state(false);
  let title = $state('');
  let url = $state('');

  function add(e: Event) {
    e.preventDefault();
    const u = normalizeUrl(url);
    if (!u) return;
    links.set([...links.value, { id: `l-${Date.now().toString(36)}`, title: title.trim() || hostLabel(u), url: u }]);
    title = url = '';
    adding = false;
  }
  function remove(id: string) {
    links.set(links.value.filter((l) => l.id !== id));
  }
</script>

<div class="links" data-testid="widget-links">
  {#each links.value as l (l.id)}
    <div class="tile">
      <a href={l.url} title={l.url}>
        <span class="fav"><img src={favicon(l.url, 32)} alt="" width="22" height="22" /></span>
        <span class="name">{l.title}</span>
      </a>
      {#if editing}<button class="ox-icon-btn rm" aria-label="×" onclick={() => remove(l.id)}>×</button>{/if}
    </div>
  {/each}
  {#if adding}
    <form class="add-form" onsubmit={add}>
      <input class="ox-input" placeholder={t('links.title')} bind:value={title} />
      <input class="ox-input" placeholder={t('links.url')} bind:value={url} required />
      <div class="ox-row"><button class="ox-btn small primary">{t('common.add')}</button><button type="button" class="ox-btn small ghost" onclick={() => (adding = false)}>{t('common.cancel')}</button></div>
    </form>
  {:else}
    {#if editing}<button class="tile add" onclick={doImport} data-testid="links-import"><span class="fav">⇩</span><span class="name">{t('links.import')}</span></button>{/if}
    <button class="tile add" onclick={() => (adding = true)} aria-label={t('common.add')}><span class="fav">+</span><span class="name">{t('common.add')}</span></button>
  {/if}
  {#if status}<p class="status ox-muted" data-testid="links-import-status">{status}</p>{/if}
</div>

<style>
  .links { height: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); grid-auto-rows: 84px; gap: 8px; overflow: auto; align-content: start; }
  .tile { position: relative; border-radius: var(--ox-radius); }
  .tile a, .tile.add { all: unset; box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border-radius: var(--ox-radius); cursor: pointer; color: var(--ox-text); }
  .tile a:hover, .tile.add:hover { background: color-mix(in srgb, var(--ox-text) 7%, transparent); }
  .fav { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--ox-text) 8%, transparent); font-size: 20px; color: var(--ox-muted); }
  .name { font-size: 12px; max-width: 90%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rm { position: absolute; top: 2px; right: 2px; }
  .status { grid-column: 1 / -1; margin: 0; font-size: 12px; }
  .add-form { grid-column: span 3; display: flex; flex-direction: column; gap: 6px; }
</style>
