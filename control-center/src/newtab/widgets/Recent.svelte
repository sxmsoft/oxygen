<script lang="ts">
  import { onMount } from 'svelte';
  import { favicon } from '../../lib/kv.svelte';
  let { settings, t }: { settings: Record<string, unknown>; t: (k: string) => string } = $props();
  interface Row { key: string; title: string; url: string; sessionId?: string }
  let rows = $state<Row[]>([]);

  async function load(mode: string) {
    if (typeof chrome === 'undefined') return;
    if (mode === 'visited' && chrome.history) {
      const h = await chrome.history.search({ text: '', maxResults: 12, startTime: Date.now() - 7 * 864e5 });
      rows = h.filter((x) => x.url && /^https?:/.test(x.url)).map((x) => ({ key: x.id, title: x.title || x.url!, url: x.url! }));
    } else if (chrome.sessions) {
      const s = await chrome.sessions.getRecentlyClosed({ maxResults: 12 });
      rows = s.flatMap((x): Row[] => {
        const tab = x.tab ?? x.window?.tabs?.[0];
        if (!tab?.url || !/^https?:/.test(tab.url)) return [];
        const extra = x.window?.tabs && x.window.tabs.length > 1 ? ` (+${x.window.tabs.length - 1})` : '';
        return [{ key: (x.tab?.sessionId ?? x.window?.sessionId ?? tab.url) + '', title: (tab.title || tab.url) + extra, url: tab.url, sessionId: x.tab?.sessionId ?? x.window?.sessionId }];
      });
    }
  }
  $effect(() => {
    void load(String(settings.mode ?? 'closed'));
  });
  onMount(() => {
    if (typeof chrome === 'undefined' || !chrome.sessions) return;
    const l = () => void load(String(settings.mode ?? 'closed'));
    chrome.sessions.onChanged.addListener(l);
    return () => chrome.sessions.onChanged.removeListener(l);
  });
  function open(r: Row, e: MouseEvent) {
    if (r.sessionId && chrome.sessions) {
      e.preventDefault();
      void chrome.sessions.restore(r.sessionId);
    }
  }
</script>

<div class="recent" data-testid="widget-recent">
  <div class="head ox-muted">{settings.mode === 'visited' ? t('w.recent.visited') : t('w.recent.closed')}</div>
  <ul class="ox-scroll">
    {#each rows as r (r.key)}
      <li><a href={r.url} onclick={(e) => open(r, e)} title={r.url}><img src={favicon(r.url, 16)} alt="" width="16" height="16" /><span>{r.title}</span></a></li>
    {:else}
      <li class="ox-muted empty">—</li>
    {/each}
  </ul>
</div>

<style>
  .recent { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin: 2px 4px 8px; }
  ul { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
  a { display: flex; align-items: center; gap: 10px; padding: 6px 6px; border-radius: 8px; color: var(--ox-text); text-decoration: none; font-size: 13px; }
  a:hover { background: color-mix(in srgb, var(--ox-text) 7%, transparent); }
  a span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { padding: 6px; }
</style>
