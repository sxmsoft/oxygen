<script lang="ts">
  import { onMount } from 'svelte';
  import BookmarkTree from '../../lib/BookmarkTree.svelte';
  import { favicon } from '../../lib/kv.svelte';
  import { BookmarkBar, ALL_BOOKMARKS_ID, type BookmarkNode } from '../../lib/bookmarks.svelte';

  let { t, settings }: { t: (k: string) => string; editing: boolean; settings: Record<string, unknown> } = $props();
  // svelte-ignore state_referenced_locally
  const bar = new BookmarkBar(settings.showAll !== false);
  $effect(() => bar.setIncludeAll(settings.showAll !== false));
  onMount(() => bar.watch());

  let openId = $state<string | null>(null);
  const openNode = $derived(bar.items.find((n) => n.id === openId));
  const label = (n: BookmarkNode) => (n.id === ALL_BOOKMARKS_ID ? t('bm.all') : n.title || n.url || '—');
</script>

<div class="bm" data-testid="widget-bookmarks">
  <div class="bar" role="toolbar">
    {#each bar.items as n (n.id)}
      {#if n.url}
        <a class="chip" href={n.url} title={n.url} data-testid="bm-bar-link"><img src={favicon(n.url, 16)} alt="" width="16" height="16" /><span>{label(n)}</span></a>
      {:else}
        <button class="chip" class:on={openId === n.id} class:all={n.id === ALL_BOOKMARKS_ID} data-testid="bm-bar-folder" onclick={() => (openId = openId === n.id ? null : n.id)}>
          <span class="ico">{n.id === ALL_BOOKMARKS_ID ? '☰' : '▸'}</span><span>{label(n)}</span>
        </button>
      {/if}
    {:else}
      {#if bar.ready}<span class="ox-muted empty">{t('bm.empty')}</span>{/if}
    {/each}
  </div>
  {#if openNode?.children}
    <div class="drop ox-scroll" data-testid="bm-drop"><BookmarkTree nodes={openNode.children} {t} /></div>
  {/if}
</div>

<style>
  .bm { height: 100%; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chip { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; max-width: 180px; padding: 5px 10px; border-radius: 999px; cursor: pointer; color: var(--ox-text); font-size: 12.5px; }
  .chip span:not(.ico) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip:hover, .chip.on { background: color-mix(in srgb, var(--ox-text) 8%, transparent); }
  .chip.all { margin-left: auto; }
  .ico { color: var(--ox-muted); }
  .drop { flex: 1; min-height: 0; overflow: auto; border-top: 1px solid color-mix(in srgb, var(--ox-text) 10%, transparent); padding-top: 4px; }
  .empty { font-size: 13px; }
</style>
