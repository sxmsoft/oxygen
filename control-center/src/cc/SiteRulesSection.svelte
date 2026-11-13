<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '../lib/i18n.svelte';
  import { StoredValue, hostLabel } from '../lib/kv.svelte';
  import { parseRules, normalizePattern, toggleDarkForHost, matchRules, type SiteRule } from '../../../extension/src/logic/siteRules.js';

  let { enabled }: { enabled: boolean } = $props();
  const t = i18n.t;
  const raw = new StoredValue<unknown>('oxygen.sites.rules', []);
  const rules = $derived(parseRules(raw.value));
  let pattern = $state('');
  let currentUrl = $state('');
  const newId = () => `rule-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  onMount(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: ['http://*/*', 'https://*/*'] });
    const recent = tab ?? (await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    currentUrl = recent?.url ?? '';
  });

  function save(next: SiteRule[]) {
    raw.set(parseRules(next));
  }
  function add(e: Event) {
    e.preventDefault();
    const p = normalizePattern(pattern);
    if (!p) return;
    save([...rules, { id: newId(), pattern: p, enabled: true, zoom: null, forceDark: false, css: '' }]);
    pattern = '';
  }
  function patch(id: string, change: Partial<SiteRule>) {
    save(rules.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }
  const currentHost = $derived(currentUrl ? hostLabel(currentUrl) : '');
  const currentDark = $derived(currentUrl ? matchRules(rules, currentUrl).forceDark : false);
</script>

<section class="panel-stack" data-testid="cc-sites">
  {#if !enabled}<article class="card"><p class="subtitle">{t('common.moduleOff')}</p></article>{/if}
  {#if currentHost}
    <article class="card quick">
      <span class="ox-muted">{t('sites.current')}: <strong>{currentHost}</strong></span>
      <label class="ox-check"><input type="checkbox" checked={currentDark} onchange={() => save(toggleDarkForHost(rules, currentHost, newId()).rules)} data-testid="sites-quick-dark" />{t('sites.toggleDark', { host: currentHost })}</label>
    </article>
  {/if}
  <article class="card">
    <h2>{t('sites.title')}</h2>
    <form class="ox-row add" onsubmit={add}>
      <input class="ox-input" placeholder={t('sites.pattern')} bind:value={pattern} data-testid="sites-pattern" />
      <button class="ox-btn primary" data-testid="sites-add">{t('sites.add')}</button>
    </form>
    <div class="rules">
      {#each rules as r (r.id)}
        <div class="rule" class:off={!r.enabled} data-testid="site-rule">
          <div class="ox-row head">
            <label class="ox-check"><input type="checkbox" checked={r.enabled} onchange={(e) => patch(r.id, { enabled: (e.target as HTMLInputElement).checked })} /><strong>{r.pattern}</strong></label>
            <span class="grow"></span>
            <label class="ox-check"><input type="checkbox" checked={!!r.forceDark} onchange={(e) => patch(r.id, { forceDark: (e.target as HTMLInputElement).checked })} />{t('sites.dark')}</label>
            <label class="ox-row zoom">{t('sites.zoom')}
              <select class="ox-select" value={r.zoom ? String(r.zoom) : ''} onchange={(e) => patch(r.id, { zoom: (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null })}>
                <option value="">{t('sites.zoomDefault')}</option>
                {#each [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as z}<option value={String(z)}>{Math.round(z * 100)}%</option>{/each}
              </select>
            </label>
            <button class="ox-btn small ghost danger" onclick={() => save(rules.filter((x) => x.id !== r.id))}>{t('common.delete')}</button>
          </div>
          <details>
            <summary class="ox-muted">{t('sites.css')}{r.css ? ' ●' : ''}</summary>
            <textarea class="ox-textarea" rows="4" spellcheck="false" value={r.css ?? ''} onchange={(e) => patch(r.id, { css: (e.target as HTMLTextAreaElement).value })} placeholder="body {'{'} font-size: 18px {'}'}"></textarea>
          </details>
        </div>
      {:else}
        <p class="ox-muted">{t('sites.empty')}</p>
      {/each}
    </div>
  </article>
</section>

<style>
  .quick { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .add { margin: 10px 0 14px; }
  .add .ox-input { flex: 1; }
  .rules { display: flex; flex-direction: column; gap: 8px; }
  .rule { border: 1px solid var(--ox-border); border-radius: var(--ox-radius); padding: 10px 12px; }
  .rule.off { opacity: 0.6; }
  .head { flex-wrap: wrap; gap: 12px; }
  .grow { flex: 1; }
  .zoom { font-size: 13px; gap: 6px; }
  .zoom .ox-select { width: auto; padding: 4px 8px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; font-size: 12px; }
  details textarea { margin-top: 6px; }
</style>
