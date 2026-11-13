<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '../lib/i18n.svelte';
  const t = i18n.t;
  let { suspenderOn }: { suspenderOn: boolean } = $props();
  let stats = $state<{ discardedNow: number; totalSuspended: number; estimatedMb: number; mbPerTab: number } | null>(null);
  let commands = $state<chrome.commands.Command[]>([]);

  async function load() {
    stats = (await chrome.runtime.sendMessage({ type: 'suspender:stats' }).catch(() => null)) ?? null;
    commands = await chrome.commands.getAll();
  }
  onMount(() => {
    void load();
    const l = () => void load();
    chrome.tabs.onUpdated.addListener(l);
    return () => chrome.tabs.onUpdated.removeListener(l);
  });
</script>

{#if suspenderOn}
  <article class="card stat" data-testid="suspender-stats">
    <span class="label">{t('suspender.title')}</span>
    <strong>{stats?.discardedNow ?? 0} · ≈{stats?.estimatedMb ?? 0} MB</strong>
    <span class="hint">{t('suspender.estimate', { mb: stats?.estimatedMb ?? 0, n: stats?.discardedNow ?? 0, per: stats?.mbPerTab ?? 50 })}</span>
    <span class="hint">{t('suspender.total')}: {stats?.totalSuspended ?? 0}. {t('suspender.note')}</span>
  </article>
{/if}
<article class="card stat" data-testid="shortcuts">
  <span class="label">{t('cc.shortcuts')}</span>
  {#each commands.filter((c) => c.name && !c.name.startsWith('_')) as c}
    <span class="row"><kbd>{c.shortcut || t('cc.notSet')}</kbd> {c.description}</span>
  {/each}
  <span class="hint">{t('cc.shortcutsHint')}</span>
</article>

<style>
  .row { font-size: 13px; display: flex; gap: 8px; align-items: center; }
  kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--ox-border); border-radius: 6px; padding: 2px 6px; min-width: 52px; text-align: center; }
</style>
