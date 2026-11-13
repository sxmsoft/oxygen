<script lang="ts">
  import { onMount } from 'svelte';
  import type { OxygenEnvironment } from '../lib/env';
  import { i18n } from '../lib/i18n.svelte';
  import { StoredValue, favicon, hostLabel, importFromHelium, normalizeUrl, type QuickLink } from '../lib/kv.svelte';
  import BookmarkTree from '../lib/BookmarkTree.svelte';
  import { BookmarkBar } from '../lib/bookmarks.svelte';
  import { moduleCfg, moduleOn } from '../lib/modules';
  import { renderMarkdown } from '../../../extension/src/logic/markdown.js';
  import { matchScore } from '../../../extension/src/logic/search.js';
  import { matchRules, parseRules } from '../../../extension/src/logic/siteRules.js';

  let { env }: { env: OxygenEnvironment } = $props();
  // svelte-ignore state_referenced_locally
  const core = env.core;
  const t = i18n.t;
  let rev = $state(0);
  /** reads `rev` so derived values refresh after external config changes */
  const track = <T,>(_dep: number, v: T): T => v;
  const enabled = $derived(track(rev, moduleOn(core, 'side-panel')));
  const showGroups = $derived(track(rev, moduleCfg<{ showGroups: boolean }>(core, 'side-panel').showGroups !== false));

  let tab = $state<'tabs' | 'bookmarks' | 'notes' | 'links'>('tabs');
  const bookmarks = new BookmarkBar(true);
  let importStatus = $state('');
  /** side panel links open in the current tab; Ctrl/Cmd/middle-click keeps the new-tab default */
  function openHere(url: string, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    if (active?.id !== undefined) void chrome.tabs.update(active.id, { url });
    else void chrome.tabs.create({ url });
  }
  let tabs = $state<chrome.tabs.Tab[]>([]);
  let groups = $state<chrome.tabGroups.TabGroup[]>([]);
  let windowId = $state<number | undefined>(undefined);
  let filter = $state('');
  let dragId = $state<number | null>(null);
  let dropBefore = $state<number | null>(null);

  const notes = new StoredValue<string>('oxygen.notes', '');
  let notesPreview = $state(false);
  const links = new StoredValue<QuickLink[]>('oxygen.links', []);
  let linkTitle = $state('');
  let linkUrl = $state('');
  const rulesRaw = new StoredValue<unknown>('oxygen.sites.rules', []);

  const active = $derived(tabs.find((x) => x.active));
  const activeDark = $derived(active?.url ? matchRules(parseRules(rulesRaw.value), active.url).forceDark : false);
  const activeWeb = $derived(/^https?:/.test(active?.url ?? ''));

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    if (windowId === undefined) windowId = (await chrome.windows.getCurrent()).id;
    tabs = await chrome.tabs.query({ windowId });
    groups = chrome.tabGroups ? await chrome.tabGroups.query({ windowId }) : [];
  }
  const soon = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 50);
  };

  onMount(() => {
    const off = env.onExternalChange(() => rev++);
    void refresh();
    const offBm = bookmarks.watch();
    const evs = [
      chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onActivated,
      chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onReplaced,
      ...(chrome.tabGroups ? [chrome.tabGroups.onUpdated, chrome.tabGroups.onCreated, chrome.tabGroups.onRemoved] : []),
    ] as chrome.events.Event<() => void>[];
    for (const ev of evs) ev.addListener(soon);
    return () => {
      off();
      offBm();
      for (const ev of evs) ev.removeListener(soon);
    };
  });

  const visible = $derived(filter.trim() ? tabs.filter((x) => Math.max(matchScore(filter, x.title ?? ''), matchScore(filter, x.url ?? '')) > 0) : tabs);
  const pinned = $derived(visible.filter((x) => x.pinned));
  /** Sections in tab-strip order: consecutive tabs of the same group form one section. */
  const sections = $derived.by(() => {
    const out: { group: chrome.tabGroups.TabGroup | null; tabs: chrome.tabs.Tab[] }[] = [];
    for (const x of visible.filter((v) => !v.pinned)) {
      const g = showGroups && x.groupId !== undefined && x.groupId >= 0 ? groups.find((gg) => gg.id === x.groupId) ?? null : null;
      const last = out[out.length - 1];
      if (last && (last.group?.id ?? -1) === (g?.id ?? -1)) last.tabs.push(x);
      else out.push({ group: g, tabs: [x] });
    }
    return out;
  });
  const GROUP_HEX: Record<string, string> = { grey: '#9aa0a6', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663', green: '#81c995', pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70' };

  async function onDrop(target: chrome.tabs.Tab) {
    const id = dragId;
    dragId = dropBefore = null;
    if (id === null || id === target.id) return;
    const src = tabs.find((x) => x.id === id);
    if (!src || src.pinned !== target.pinned) return;
    const srcIndex = src.index;
    let index = target.index;
    if (srcIndex < index) index -= 1; // removing the source shifts the target left
    await chrome.tabs.move(id, { index: Math.max(0, index) });
    if (showGroups && chrome.tabGroups) {
      if (target.groupId !== undefined && target.groupId >= 0) await chrome.tabs.group({ tabIds: id, groupId: target.groupId });
      else if (src.groupId !== undefined && src.groupId >= 0) await chrome.tabs.ungroup(id);
    }
    await refresh();
  }
  async function toggleGroup(g: chrome.tabGroups.TabGroup) {
    await chrome.tabGroups.update(g.id, { collapsed: !g.collapsed });
  }
  function addLink(e: Event) {
    e.preventDefault();
    const u = normalizeUrl(linkUrl);
    if (!u) return;
    links.set([...links.value, { id: `l-${Date.now().toString(36)}`, title: linkTitle.trim() || hostLabel(u), url: u }]);
    linkTitle = linkUrl = '';
  }
  async function cmd(id: string) {
    await chrome.runtime.sendMessage({ type: 'palette:command', id, tabId: active?.id });
  }
</script>

<div class="sp" data-testid="sidepanel">
  {#if !enabled}
    <p class="ox-muted off">{t('common.moduleOff')}</p>
  {:else}
    <nav class="tabs-nav">
      <button class:on={tab === 'tabs'} onclick={() => (tab = 'tabs')} data-testid="sp-tab-tabs">{t('side.tabs')} <span class="n">{tabs.length}</span></button>
      <button class:on={tab === 'bookmarks'} onclick={() => (tab = 'bookmarks')} data-testid="sp-tab-bookmarks">{t('side.bookmarks')}</button>
      <button class:on={tab === 'notes'} onclick={() => (tab = 'notes')} data-testid="sp-tab-notes">{t('side.notes')}</button>
      <button class:on={tab === 'links'} onclick={() => (tab = 'links')} data-testid="sp-tab-links">{t('side.links')}</button>
    </nav>

    {#if tab === 'tabs'}
      <input class="ox-input filter" placeholder={t('side.searchTabs')} bind:value={filter} data-testid="sp-filter" />
      {#if pinned.length}
        <div class="pinned">
          {#each pinned as p (p.id)}
            <button class="pin" class:active={p.active} title={p.title} onclick={() => chrome.tabs.update(p.id!, { active: true })}><img src={favicon(p.url ?? '', 16)} alt="" width="16" height="16" /></button>
          {/each}
        </div>
      {/if}
      <div class="list ox-scroll" data-testid="sp-tab-list">
        {#each sections as s, si (s.group ? `g${s.group.id}-${si}` : `u${si}`)}
          {#if s.group}
            <button class="group" style="--g:{GROUP_HEX[s.group.color] ?? '#9aa0a6'}" onclick={() => toggleGroup(s.group!)} data-testid="sp-group">
              <span class="gdot"></span><span class="gt">{s.group.title || '—'}</span><span class="n">{s.tabs.length}</span><span class="chev">{s.group.collapsed ? '▸' : '▾'}</span>
            </button>
          {/if}
          {#if !s.group?.collapsed}
            {#each s.tabs as x (x.id)}
              <div
                class="row"
                class:active={x.active}
                class:discarded={x.discarded}
                class:grouped={!!s.group}
                class:drop={dropBefore === x.id}
                style={s.group ? `--g:${GROUP_HEX[s.group.color] ?? '#9aa0a6'}` : ''}
                draggable="true"
                role="button"
                tabindex="0"
                data-tab-id={x.id}
                ondragstart={(e) => { dragId = x.id!; e.dataTransfer?.setData('text/plain', String(x.id)); }}
                ondragover={(e) => { e.preventDefault(); dropBefore = x.id!; }}
                ondragleave={() => dropBefore === x.id && (dropBefore = null)}
                ondrop={(e) => { e.preventDefault(); void onDrop(x); }}
                onclick={() => chrome.tabs.update(x.id!, { active: true })}
                onkeydown={(e) => e.key === 'Enter' && chrome.tabs.update(x.id!, { active: true })}
              >
                <img src={favicon(x.url ?? '', 16)} alt="" width="16" height="16" />
                <span class="title">{x.title || x.url}</span>
                {#if x.discarded}<span class="zz" title="Suspended">zz</span>{/if}
                {#if x.audible}<span class="zz">♪</span>{/if}
                <button class="ox-icon-btn close" aria-label={t('side.closeTab')} onclick={(e) => { e.stopPropagation(); void chrome.tabs.remove(x.id!); }}>✕</button>
              </div>
            {/each}
          {/if}
        {/each}
      </div>
      <footer class="quick">
        {#if moduleOn(core, 'site-rules') && activeWeb}
          <label class="ox-check" data-testid="sp-dark-toggle"><input type="checkbox" checked={activeDark} onchange={() => cmd('toggle-dark')} />{t('sites.toggleDark', { host: hostLabel(active?.url ?? '') })}</label>
        {/if}
        {#if moduleOn(core, 'tab-suspender')}
          <button class="ox-btn small" onclick={() => cmd('suspend-others')}>{t('cmd.suspend-others')}</button>
        {/if}
      </footer>
    {:else if tab === 'notes'}
      <div class="notes">
        <div class="ox-row end"><button class="ox-btn small ghost" onclick={() => (notesPreview = !notesPreview)}>{notesPreview ? t('notes.edit') : t('notes.preview')}</button></div>
        {#if notesPreview}
          <div class="ox-md md ox-scroll" data-testid="sp-notes-preview">{@html renderMarkdown(notes.value)}</div>
        {:else}
          <textarea class="ox-textarea area" data-testid="sp-notes" placeholder={t('notes.placeholder')} value={notes.value} oninput={(e) => notes.set((e.target as HTMLTextAreaElement).value, 400)}></textarea>
        {/if}
      </div>
    {:else if tab === 'bookmarks'}
      <div class="list ox-scroll" data-testid="sp-bookmarks">
        {#if bookmarks.items.length}
          <BookmarkTree nodes={bookmarks.items} {t} onopen={openHere} />
        {:else if bookmarks.ready}
          <p class="ox-muted">{t('bm.empty')}</p>
        {/if}
      </div>
      <button class="ox-btn small ghost" onclick={() => chrome.tabs.create({ url: 'chrome://bookmarks/' })}>{t('bm.manage')}</button>
    {:else}
      <form class="link-form" onsubmit={addLink}>
        <input class="ox-input" placeholder={t('links.title')} bind:value={linkTitle} />
        <input class="ox-input" placeholder={t('links.url')} bind:value={linkUrl} required data-testid="sp-link-url" />
        <button class="ox-btn small primary">{t('common.add')}</button>
      </form>
      <ul class="links ox-scroll">
        {#each links.value as l (l.id)}
          <li>
            <a href={l.url} target="_blank" rel="noreferrer"><img src={favicon(l.url, 16)} alt="" width="16" height="16" /><span>{l.title}</span></a>
            <button class="ox-icon-btn" aria-label={t('common.delete')} onclick={() => links.set(links.value.filter((x) => x.id !== l.id))}>✕</button>
          </li>
        {:else}
          <li class="ox-muted">{t('links.empty')}</li>
        {/each}
      </ul>
      <button class="ox-btn small ghost" data-testid="sp-links-import" onclick={async () => (importStatus = await importFromHelium(t))}>{t('links.import')}</button>
      {#if importStatus}<p class="ox-muted">{importStatus}</p>{/if}
    {/if}
  {/if}
</div>

<style>
  :global(body) { background: var(--ox-toolbar); }
  .sp { height: 100vh; display: flex; flex-direction: column; padding: 10px; gap: 8px; font-size: 13px; }
  .off { padding: 20px; }
  .tabs-nav { display: flex; gap: 4px; background: var(--ox-bg); padding: 3px; border-radius: calc(var(--ox-radius) + 2px); border: 1px solid var(--ox-border); }
  .tabs-nav button { flex: 1; border: 0; background: transparent; color: var(--ox-muted); padding: 6px; border-radius: var(--ox-radius); cursor: pointer; font-size: 12.5px; }
  .tabs-nav button.on { background: var(--ox-surface); color: var(--ox-text); }
  .n { color: var(--ox-muted); font-size: 11px; margin-left: 2px; }
  .pinned { display: flex; flex-wrap: wrap; gap: 4px; }
  .pin { width: 34px; height: 30px; border: 1px solid var(--ox-border); background: var(--ox-surface); border-radius: 8px; display: grid; place-items: center; cursor: pointer; }
  .pin.active { border-color: var(--ox-accent); }
  .list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
  .group { all: unset; display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin-top: 4px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; }
  .group:hover { background: color-mix(in srgb, var(--ox-text) 6%, transparent); }
  .gdot { width: 10px; height: 10px; border-radius: 50%; background: var(--g); }
  .gt { flex: 1; }
  .chev { color: var(--ox-muted); }
  .row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; border-top: 2px solid transparent; }
  .row:hover { background: color-mix(in srgb, var(--ox-text) 6%, transparent); }
  .row.active { background: color-mix(in srgb, var(--ox-accent) 14%, transparent); }
  .row.grouped { margin-left: 8px; box-shadow: inset 2px 0 0 var(--g); }
  .row.discarded { opacity: 0.55; }
  .row.drop { border-top-color: var(--ox-accent); }
  .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .zz { font-size: 10px; color: var(--ox-muted); border: 1px solid var(--ox-border); border-radius: 6px; padding: 0 4px; }
  .close { visibility: hidden; width: 20px; height: 20px; font-size: 11px; }
  .row:hover .close { visibility: visible; }
  .quick { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--ox-border); padding-top: 8px; }
  .notes { flex: 1; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .end { justify-content: flex-end; }
  .area { flex: 1; resize: none; }
  .md { flex: 1; overflow: auto; padding: 4px; }
  .link-form { display: flex; flex-direction: column; gap: 6px; }
  .links { list-style: none; margin: 0; padding: 0; overflow: auto; }
  .links li { display: flex; align-items: center; gap: 6px; }
  .links a { flex: 1; display: flex; gap: 8px; align-items: center; padding: 7px 6px; border-radius: 8px; color: var(--ox-text); text-decoration: none; min-width: 0; }
  .links a span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .links a:hover { background: color-mix(in srgb, var(--ox-text) 6%, transparent); }
</style>
