<script lang="ts">
  import { onMount } from 'svelte';
  import { ingestShortcuts } from '../../../../extension/src/features/shortcuts.js';
  import { TILE_COLORS, colorFor, letterFor, moveLink, parseIcon, type LinkIcon as Icon } from '../../../../extension/src/logic/linkIcons.js';
  import { StoredValue, hostLabel, importFromHelium, normalizeUrl, type QuickLink } from '../../lib/kv.svelte';
  import { deleteCustomIcon, putCustomIcon } from '../../lib/iconStore';
  import LinkIcon from './LinkIcon.svelte';

  let { t, editing, settings = {} }: { t: (k: string, p?: Record<string, string | number>) => string; editing: boolean; settings?: Record<string, unknown> } = $props();

  const iconSize = $derived(Math.min(96, Math.max(24, Number(settings.iconSize) || 44)));
  const shape = $derived(String(settings.shape ?? 'rounded'));
  const showLabels = $derived(settings.showLabels !== false);
  const cols = $derived(settings.columns && settings.columns !== 'auto' ? Number(settings.columns) : 0);
  const align = $derived(String(settings.align ?? 'start'));
  const card = $derived(settings.tile === 'card');
  const tileW = $derived(Math.max(iconSize + 34, showLabels ? 86 : 0));
  const tileH = $derived(iconSize + (showLabels ? 36 : 18));

  let status = $state('');
  // Picks up a new Helium import even when the service worker missed it (applied once per content).
  onMount(() => void ingestShortcuts(false).catch(() => {}));
  async function doImport() {
    status = await importFromHelium(t);
  }
  const links = new StoredValue<QuickLink[]>('oxygen.links', []);

  // ---- edit / add dialog ----
  type Draft = { id: string | null; title: string; url: string; kind: Icon['kind']; text: string; bg: string; imageId: string; refresh: number };
  let draft = $state<Draft | null>(null);
  let dialogError = $state('');
  function openEdit(l: QuickLink | null) {
    const ic = parseIcon(l?.icon);
    dialogError = '';
    draft = {
      id: l?.id ?? null, title: l?.title ?? '', url: l?.url ?? '', kind: ic.kind,
      text: ic.kind === 'emoji' || ic.kind === 'letter' ? ic.text : ic.kind === 'image' ? '' : '',
      bg: ic.kind === 'emoji' || ic.kind === 'letter' ? ic.bg : colorFor(l?.url ?? ''),
      imageId: ic.kind === 'image' ? ic.id : '', refresh: 0,
    };
  }
  function iconOf(d: Draft): Icon {
    if (d.kind === 'image' && d.imageId) return { kind: 'image', id: d.imageId };
    if (d.kind === 'emoji' && d.text.trim()) return { kind: 'emoji', text: d.text.trim(), bg: d.bg };
    if (d.kind === 'letter') return { kind: 'letter', text: d.text.trim() || letterFor(d.title, d.url), bg: d.bg };
    return { kind: 'auto' };
  }
  async function save(e: Event) {
    e.preventDefault();
    if (!draft) return;
    const u = normalizeUrl(draft.url);
    if (!u) return void (dialogError = t('links.url'));
    const icon = iconOf(draft);
    const prev = draft.id ? links.value.find((l) => l.id === draft!.id) : undefined;
    const old = parseIcon(prev?.icon);
    if (old.kind === 'image' && (icon.kind !== 'image' || icon.id !== old.id)) void deleteCustomIcon(old.id);
    const item: QuickLink = { ...(prev ?? { id: `l-${Date.now().toString(36)}` }), title: draft.title.trim() || hostLabel(u), url: u, ...(icon.kind === 'auto' ? { icon: undefined } : { icon }) };
    links.set(prev ? links.value.map((l) => (l.id === prev.id ? item : l)) : [...links.value, item]);
    draft = null;
  }
  function remove(id: string) {
    const ic = parseIcon(links.value.find((l) => l.id === id)?.icon);
    if (ic.kind === 'image') void deleteCustomIcon(ic.id);
    links.set(links.value.filter((l) => l.id !== id));
    draft = null;
  }
  async function upload(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f || !draft) return;
    try {
      draft.imageId = await putCustomIcon(f);
      draft.kind = 'image';
      dialogError = '';
    } catch (err) {
      dialogError = err instanceof Error ? err.message : String(err);
    }
  }

  // ---- reorder (edit mode, pointer based) ----
  let order = $state<QuickLink[] | null>(null);
  let dragId = $state<string | null>(null);
  let start = $state({ x: 0, y: 0, moved: false });
  const shown = $derived(order ?? links.value);
  function down(e: PointerEvent, id: string) {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragId = id;
    start = { x: e.clientX, y: e.clientY, moved: false };
    order = links.value;
  }
  function move(e: PointerEvent) {
    if (!dragId || !order) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    start.moved = true;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n instanceof HTMLElement && n.dataset.linkId && n.dataset.linkId !== dragId) as HTMLElement | undefined;
    if (!el) return;
    const target = el.dataset.linkId!;
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    const list = order.filter((l) => l.id !== dragId);
    const idx = list.findIndex((l) => l.id === target) + (after ? 1 : 0);
    order = moveLink(order, dragId, list[idx]?.id ?? null);
  }
  function up() {
    if (!dragId) return;
    if (order && start.moved) links.set(order);
    else {
      const l = links.value.find((x) => x.id === dragId);
      if (l) openEdit(l);
    }
    dragId = null;
    order = null;
  }
</script>

<svelte:window onpointermove={move} onpointerup={up} onpointercancel={up} />

<div class="links" class:card class:editing data-testid="widget-links"
  style="--tw:{tileW}px;--th:{tileH}px;grid-template-columns:{cols ? `repeat(${cols}, var(--tw))` : 'repeat(auto-fill, var(--tw))'};justify-content:{align === 'center' ? 'center' : align === 'end' ? 'end' : 'start'}">
  {#each shown as l (l.id)}
    <div class="tile" class:dragging={dragId === l.id && start.moved} data-link-id={l.id} data-testid="link-tile">
      {#if editing}
        <div class="hit" role="button" tabindex="0" title={t('links.dragHint')} onpointerdown={(e) => down(e, l.id)} onkeydown={(e) => e.key === 'Enter' && openEdit(l)}>
          <LinkIcon url={l.url} title={l.title} icon={l.icon} size={iconSize} {shape} />
          {#if showLabels}<span class="name">{l.title}</span>{/if}
        </div>
      {:else}
        <a class="hit" href={l.url} title={l.title}>
          <LinkIcon url={l.url} title={l.title} icon={l.icon} size={iconSize} {shape} />
          {#if showLabels}<span class="name">{l.title}</span>{/if}
        </a>
        <button class="ox-icon-btn ed" aria-label={t('links.edit')} data-testid="link-edit" onclick={() => openEdit(l)}>✎</button>
      {/if}
    </div>
  {/each}
  {#if editing}<button class="tile add" onclick={doImport} data-testid="links-import"><span class="plus" style="--s:{iconSize}px">⇩</span>{#if showLabels}<span class="name">{t('links.import')}</span>{/if}</button>{/if}
  <button class="tile add" data-testid="link-add" onclick={() => openEdit(null)} aria-label={t('common.add')}><span class="plus" style="--s:{iconSize}px">+</span>{#if showLabels}<span class="name">{t('common.add')}</span>{/if}</button>
  {#if status}<p class="status ox-muted" data-testid="links-import-status">{status}</p>{/if}
</div>

{#if draft}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && (draft = null)}>
    <form class="dialog ox-glass" data-testid="link-dialog" onsubmit={save}>
      <strong>{draft.id ? t('links.edit') : t('common.add')}</strong>
      <div class="preview">
        <LinkIcon url={normalizeUrl(draft.url) ?? ''} title={draft.title} icon={iconOf(draft)} size={56} {shape} refresh={draft.refresh} />
      </div>
      <label class="ox-label">{t('links.title')}<input class="ox-input" data-testid="link-title" bind:value={draft.title} /></label>
      <label class="ox-label">{t('links.url')}<input class="ox-input" data-testid="link-url" bind:value={draft.url} required /></label>
      <div class="ox-label">{t('links.icon')}
        <div class="kinds">
          {#each ['auto', 'image', 'emoji', 'letter'] as const as k}
            <button type="button" class="ox-btn small" class:primary={draft.kind === k} data-testid="icon-kind-{k}" onclick={() => (draft!.kind = k)}>{t('icon.' + k)}</button>
          {/each}
        </div>
      </div>
      {#if draft.kind === 'auto'}
        <button type="button" class="ox-btn small ghost" onclick={() => draft!.refresh++}>{t('icon.refresh')}</button>
      {:else if draft.kind === 'image'}
        <label class="ox-btn small">{t('icon.upload')}<input type="file" accept="image/*" hidden data-testid="icon-upload" onchange={upload} /></label>
      {:else}
        <div class="ox-row">
          <input class="ox-input" data-testid="icon-text" maxlength={draft.kind === 'letter' ? 2 : 8} placeholder={draft.kind === 'letter' ? letterFor(draft.title, draft.url) : '🙂'} bind:value={draft.text} />
          <input type="color" aria-label={t('icon.color')} bind:value={draft.bg} />
        </div>
        <div class="swatches">{#each TILE_COLORS as c}<button type="button" aria-label={c} style="background:{c}" onclick={() => (draft!.bg = c)}></button>{/each}</div>
      {/if}
      {#if dialogError}<p class="err">{dialogError}</p>{/if}
      <div class="ox-row actions">
        {#if draft.id}<button type="button" class="ox-btn small ghost danger" data-testid="link-remove" onclick={() => remove(draft!.id!)}>{t('links.remove')}</button>{/if}
        <span class="sp"></span>
        <button type="button" class="ox-btn small ghost" onclick={() => (draft = null)}>{t('common.cancel')}</button>
        <button class="ox-btn small primary" data-testid="link-save">{t('common.save')}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  .links { height: 100%; display: grid; grid-auto-rows: var(--th); gap: 8px; overflow: auto; align-content: start; }
  .tile { position: relative; border-radius: var(--ox-radius); }
  .tile.dragging { opacity: 0.45; }
  .hit, .tile.add { all: unset; box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; border-radius: var(--ox-radius); cursor: pointer; color: var(--ox-text); }
  .editing .hit { cursor: grab; touch-action: none; }
  .hit:hover, .tile.add:hover { background: color-mix(in srgb, var(--ox-text) 7%, transparent); }
  .card .hit { background: color-mix(in srgb, var(--ox-surface) 60%, transparent); border: 1px solid var(--ox-border); }
  .plus { width: var(--s); height: var(--s); border-radius: 28%; display: grid; place-items: center; background: color-mix(in srgb, var(--ox-text) 8%, transparent); font-size: calc(var(--s) * 0.45); color: var(--ox-muted); }
  .name { font-size: 12px; max-width: 92%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ed { position: absolute; top: 0; right: 0; opacity: 0; font-size: 12px; transition: opacity 120ms; }
  .tile:hover .ed, .ed:focus-visible { opacity: 0.85; }
  .status { grid-column: 1 / -1; margin: 0; font-size: 12px; }
  .backdrop { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: rgba(0, 0, 0, 0.35); }
  .dialog { width: 340px; max-width: calc(100vw - 32px); padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .preview { display: grid; place-items: center; padding: 4px 0; }
  .kinds { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .swatches { display: flex; gap: 6px; }
  .swatches button { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--ox-border); cursor: pointer; }
  input[type='color'] { width: 42px; height: 32px; border: 1px solid var(--ox-border); background: transparent; border-radius: 8px; }
  .actions { align-items: center; }
  .sp { flex: 1; }
  .err { color: #fca5a5; font-size: 12px; margin: 0; }
</style>
