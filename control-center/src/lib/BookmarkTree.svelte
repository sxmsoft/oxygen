<script lang="ts">
  import BookmarkTree from './BookmarkTree.svelte';
  import { favicon } from './kv.svelte';
  import { ALL_BOOKMARKS_ID, type BookmarkNode } from './bookmarks.svelte';

  let {
    nodes,
    t,
    depth = 0,
    onopen,
  }: { nodes: BookmarkNode[]; t: (k: string) => string; depth?: number; onopen?: (url: string, e: MouseEvent) => void } = $props();
  let open = $state<Record<string, boolean>>({});
  const label = (n: BookmarkNode) => (n.id === ALL_BOOKMARKS_ID ? t('bm.all') : n.title || n.url || '—');
</script>

<ul class="bm-tree" class:root={depth === 0} data-testid={depth === 0 ? 'bm-tree' : undefined}>
  {#each nodes as n (n.id)}
    <li>
      {#if n.url}
        <a class="bm-row" href={n.url} title={n.url} style="--d:{depth}" data-testid="bm-link" onclick={(e) => onopen?.(n.url!, e)}>
          <img src={favicon(n.url, 16)} alt="" width="16" height="16" /><span>{label(n)}</span>
        </a>
      {:else}
        <button class="bm-row folder" style="--d:{depth}" aria-expanded={!!open[n.id]} data-testid="bm-folder" onclick={() => (open[n.id] = !open[n.id])}>
          <span class="ico">{open[n.id] ? '▾' : '▸'}</span><span>{label(n)}</span><span class="n">{n.children?.length ?? 0}</span>
        </button>
        {#if open[n.id] && n.children?.length}
          <BookmarkTree nodes={n.children} {t} depth={depth + 1} {onopen} />
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .bm-tree { list-style: none; margin: 0; padding: 0; }
  .bm-row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px 6px calc(8px + var(--d) * 14px); border-radius: 8px; cursor: pointer; color: var(--ox-text); font-size: 13px; min-width: 0; }
  .bm-row:hover { background: color-mix(in srgb, var(--ox-text) 7%, transparent); }
  .bm-row span:not(.ico):not(.n) { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ico { width: 16px; text-align: center; color: var(--ox-muted); }
  .n { font-size: 11px; color: var(--ox-muted); }
</style>
