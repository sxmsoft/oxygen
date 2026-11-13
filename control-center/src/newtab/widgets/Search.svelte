<script lang="ts">
  let { t }: { t: (k: string) => string } = $props();
  let q = $state('');
  function submit(e: Event) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    if (typeof chrome !== 'undefined' && chrome.search) void chrome.search.query({ text, disposition: 'CURRENT_TAB' });
    else location.href = `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
  }
</script>

<form class="search" onsubmit={submit} data-testid="widget-search">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  <input bind:value={q} placeholder={t('w.search.placeholder')} aria-label={t('w.search')} />
  <kbd>Ctrl K</kbd>
</form>

<style>
  .search { height: 100%; display: flex; align-items: center; gap: 12px; padding: 0 8px; color: var(--ox-muted); }
  input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--ox-text); font-size: 17px; }
  input::placeholder { color: var(--ox-muted); }
  kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--ox-border); border-radius: 6px; padding: 2px 6px; opacity: 0.8; }
</style>
