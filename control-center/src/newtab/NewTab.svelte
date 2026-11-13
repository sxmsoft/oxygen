<script lang="ts">
  import { onMount } from 'svelte';
  import type { OxygenEnvironment } from '../lib/env';
  import { i18n } from '../lib/i18n.svelte';
  import { StoredValue } from '../lib/kv.svelte';
  import { moduleCfg, moduleOn } from '../lib/modules';
  import { installPagePalette } from '../lib/pagePalette';
  import {
    addWidget, layoutHeight, moveWidget, parseLayout, removeWidget, resizeWidget, updateWidgetSettings, GRID_COLUMNS, type Layout,
  } from '../../../extension/src/logic/layout.js';
  import { WIDGETS, defaultLayout, defaultSettings, widgetDef } from './widgets';
  import WidgetHost from './WidgetHost.svelte';
  import Wallpaper from './Wallpaper.svelte';
  import { putMedia, deleteMedia } from './wallpaperStore';
  import logoSvg from '../../../resources/branding/product_logo.svg';

  let { env }: { env: OxygenEnvironment } = $props();
  // svelte-ignore state_referenced_locally
  const core = env.core;
  const t = i18n.t;

  let rev = $state(0);
  /** reads `rev` so derived values refresh after external config changes */
  const track = <T,>(_dep: number, v: T): T => v;
  const widgetsOn = $derived(track(rev, moduleOn(core, 'newtab-widgets')));
  const wallpaperOn = $derived(track(rev, moduleOn(core, 'wallpapers')));
  const wp = $derived(track(rev, moduleCfg(core, 'wallpapers')));
  const rowH = $derived(track(rev, Number(moduleCfg<{ rowHeight: number }>(core, 'newtab-widgets').rowHeight) || 84));
  const accent = $derived(track(rev, core.getActiveThemeTokens().accentColor ?? '#d8dee9'));

  const stored = new StoredValue<unknown>('oxygen.newtab.layout', null);
  const layout = $derived<Layout>(stored.ready ? parseLayout(stored.value, WIDGETS) ?? defaultLayout(i18n.locale) : []);
  let preview = $state<Layout | null>(null);
  const shown = $derived(preview ?? layout);

  let editing = $state(false);
  let drawer = $state(false);
  let settingsFor = $state<string | null>(null);
  let gridEl = $state<HTMLDivElement | null>(null);
  let gridW = $state(1100);
  const GAP = 14;
  const colW = $derived((gridW - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const height = $derived(layoutHeight(shown) * (rowH + GAP));

  let drag = $state<{ id: string; mode: 'move' | 'resize'; dx: number; dy: number; px: number; py: number } | null>(null);
  let uploadError = $state('');

  onMount(() => {
    installPagePalette(core);
    const off = env.onExternalChange(() => rev++);
    const ro = new ResizeObserver(() => gridEl && (gridW = gridEl.clientWidth));
    if (gridEl) ro.observe(gridEl);
    return () => {
      off();
      ro.disconnect();
    };
  });

  function commit(next: Layout) {
    stored.set(JSON.parse(JSON.stringify(next)));
  }
  const pos = (p: { x: number; y: number; w: number; h: number }) =>
    `left:${p.x * (colW + GAP)}px;top:${p.y * (rowH + GAP)}px;width:${p.w * colW + (p.w - 1) * GAP}px;height:${p.h * rowH + (p.h - 1) * GAP}px`;

  function startDrag(e: PointerEvent, id: string, mode: 'move' | 'resize') {
    if (!editing || e.button !== 0) return;
    const item = layout.find((p) => p.id === id);
    if (!item || !gridEl) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = gridEl.getBoundingClientRect();
    drag = { id, mode, dx: e.clientX - r.left - item.x * (colW + GAP), dy: e.clientY - r.top - item.y * (rowH + GAP), px: e.clientX - r.left, py: e.clientY - r.top };
    preview = layout;
  }
  function onMove(e: PointerEvent) {
    if (!drag || !gridEl) return;
    const r = gridEl.getBoundingClientRect();
    drag.px = e.clientX - r.left;
    drag.py = e.clientY - r.top;
    const item = layout.find((p) => p.id === drag!.id)!;
    if (drag.mode === 'move') {
      const x = Math.round((drag.px - drag.dx) / (colW + GAP));
      const y = Math.round((drag.py - drag.dy) / (rowH + GAP));
      preview = moveWidget(layout, drag.id, x, Math.max(0, y), WIDGETS);
    } else {
      const w = Math.round((drag.px - item.x * (colW + GAP) + GAP) / (colW + GAP));
      const h = Math.round((drag.py - item.y * (rowH + GAP) + GAP) / (rowH + GAP));
      preview = resizeWidget(layout, drag.id, w, h, WIDGETS);
    }
  }
  function endDrag() {
    if (!drag) return;
    if (preview) commit(preview);
    drag = null;
    preview = null;
  }
  function onKey(e: KeyboardEvent, id: string) {
    if (!editing) return;
    const p = layout.find((x) => x.id === id)!;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    commit(e.shiftKey ? resizeWidget(layout, id, p.w + d[0], p.h + d[1], WIDGETS) : moveWidget(layout, id, p.x + d[0], Math.max(0, p.y + d[1]), WIDGETS));
  }
  function add(type: string) {
    commit(addWidget(layout, type, WIDGETS, `w-${type}-${Date.now().toString(36)}`, defaultSettings(type)));
  }
  function setWidgetSetting(id: string, key: string, value: unknown) {
    commit(updateWidgetSettings(layout, id, { [key]: value }));
  }
  async function setWp(key: string, value: unknown) {
    await core.modules.updateModuleConfig('wallpapers', key, value);
    rev++;
  }
  async function upload(e: Event, slot: 'image' | 'video') {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    uploadError = '';
    try {
      await putMedia(slot, file);
      await setWp('kind', slot);
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
    }
  }
  const draggedStyle = $derived.by(() => {
    if (!drag) return '';
    const p = layout.find((x) => x.id === drag!.id);
    if (!p) return '';
    if (drag.mode === 'move') return pos({ ...p, x: 0, y: 0 }) + `;transform:translate(${drag.px - drag.dx}px,${drag.py - drag.dy}px)`;
    return '';
  });
</script>

<svelte:window onpointermove={onMove} onpointerup={endDrag} onpointercancel={endDrag} />

{#if wallpaperOn}<Wallpaper cfg={wp} {accent} />{/if}

<div class="page" class:editing data-testid="newtab">
  <header class="top">
    <div class="brand"><img src={logoSvg} alt="" width="22" height="22" /><span>Oxygen</span></div>
    <div class="actions">
      {#if widgetsOn || wallpaperOn}
        <button class="ox-btn ghost" data-testid="customize" onclick={() => {
          if (editing && !drawer) drawer = true;
          else {
            editing = !editing;
            drawer = editing;
            settingsFor = null;
          }
        }}>
          {editing && drawer ? t('common.done') : t('nt.customize')}
        </button>
      {/if}
      <a class="ox-btn ghost" href="index.html#dashboard">{t('common.settings')}</a>
    </div>
  </header>

  {#if widgetsOn}
    <div class="grid" bind:this={gridEl} style="height:{height}px" data-testid="widget-grid">
      {#if drag && preview}
        {@const target = preview.find((p) => p.id === drag!.id)}
        {#if target}<div class="placeholder" style={pos(target)}></div>{/if}
      {/if}
      {#each shown as w (w.id)}
        {@const def = widgetDef(w.type)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (focusable only in edit mode: arrow keys move, Shift+arrows resize) -->
        <div
          class="widget ox-glass type-{w.type}"
          class:dragging={drag?.id === w.id && drag.mode === 'move'}
          style={drag?.id === w.id && drag.mode === 'move' ? draggedStyle : pos(w)}
          data-widget-id={w.id}
          data-widget-type={w.type}
          role={editing ? 'button' : 'group'}
          aria-label={def ? t(def.title) : w.type}
          tabindex={editing ? 0 : -1}
          onkeydown={(e) => onKey(e, w.id)}
        >
          {#if editing}
            <div class="chrome" role="presentation" onpointerdown={(e) => startDrag(e, w.id, 'move')}>
              <span class="grip">⠿ {def ? t(def.title) : w.type}</span>
              <span class="ox-row">
                {#if def?.settings.length}<button class="ox-icon-btn" aria-label={t('common.settings')} onpointerdown={(e) => e.stopPropagation()} onclick={() => (settingsFor = settingsFor === w.id ? null : w.id)}>⚙</button>{/if}
                <button class="ox-icon-btn" aria-label={t('nt.remove')} data-testid="remove-widget" onpointerdown={(e) => e.stopPropagation()} onclick={() => commit(removeWidget(layout, w.id))}>✕</button>
              </span>
            </div>
          {/if}
          <div class="body">
            <WidgetHost type={w.type} props={{ settings: w.settings, t, locale: i18n.locale, editing, core }} />
          </div>
          {#if editing && settingsFor === w.id && def}
            <div class="settings ox-glass" data-testid="widget-settings">
              {#each def.settings as s}
                {#if s.type === 'boolean'}
                  <label class="ox-check"><input type="checkbox" checked={w.settings[s.key] !== undefined ? !!w.settings[s.key] : !!s.default} onchange={(e) => setWidgetSetting(w.id, s.key, (e.target as HTMLInputElement).checked)} />{t(s.label)}</label>
                {:else if s.type === 'select'}
                  <label class="ox-label">{t(s.label)}<select class="ox-select" value={String(w.settings[s.key] ?? s.default)} onchange={(e) => setWidgetSetting(w.id, s.key, (e.target as HTMLSelectElement).value)}>{#each s.options ?? [] as o}<option value={o.value}>{t(o.label)}</option>{/each}</select></label>
                {:else}
                  <label class="ox-label">{t(s.label)}<input class="ox-input" value={String(w.settings[s.key] ?? s.default)} onchange={(e) => setWidgetSetting(w.id, s.key, (e.target as HTMLInputElement).value)} /></label>
                {/if}
              {/each}
            </div>
          {/if}
          {#if editing}<div class="resize" role="presentation" data-testid="resize-handle" onpointerdown={(e) => startDrag(e, w.id, 'resize')}></div>{/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="minimal">
      <img src={logoSvg} alt="" width="64" height="64" />
      <p class="ox-muted">{t('nt.widgetsOff')}</p>
    </div>
  {/if}
</div>

{#if drawer}
  <aside class="drawer ox-glass ox-scroll" data-testid="customize-drawer">
    <div class="dh"><strong>{t('nt.customize')}</strong><button class="ox-icon-btn" aria-label={t('common.close')} onclick={() => (drawer = false)}>✕</button></div>
    {#if widgetsOn}
      <h3>{t('nt.addWidget')}</h3>
      <div class="add-list">
        {#each WIDGETS as d}
          <button class="ox-btn" data-testid="add-{d.type}" onclick={() => add(d.type)}><span>{d.icon}</span>{t(d.title)}</button>
        {/each}
      </div>
      <button class="ox-btn small ghost" onclick={() => commit(defaultLayout(i18n.locale))}>{t('nt.resetLayout')}</button>
    {/if}
    {#if wallpaperOn}
      <h3>{t('nt.wallpaper')}</h3>
      <label class="ox-label">{t('wp.kind')}
        <select class="ox-select" data-testid="wp-kind" value={String(wp.kind)} onchange={(e) => setWp('kind', (e.target as HTMLSelectElement).value)}>
          {#each ['none', 'solid', 'gradient', 'image', 'video', 'aurora', 'particles'] as k}<option value={k}>{t('wp.' + k)}</option>{/each}
        </select>
      </label>
      {#if wp.kind === 'solid' || wp.kind === 'gradient'}
        <div class="ox-row colors">
          <input type="color" value={String(wp.color1)} onchange={(e) => setWp('color1', (e.target as HTMLInputElement).value)} aria-label="Color 1" />
          {#if wp.kind === 'gradient'}
            <input type="color" value={String(wp.color2)} onchange={(e) => setWp('color2', (e.target as HTMLInputElement).value)} aria-label="Color 2" />
            <input type="range" min="0" max="360" step="15" value={Number(wp.angle)} onchange={(e) => setWp('angle', Number((e.target as HTMLInputElement).value))} aria-label="Angle" />
          {/if}
        </div>
      {/if}
      <div class="ox-row uploads">
        <label class="ox-btn small">{t('wp.upload')} · {t('wp.image')}<input type="file" accept="image/*" hidden data-testid="wp-upload-image" onchange={(e) => upload(e, 'image')} /></label>
        <label class="ox-btn small">{t('wp.upload')} · {t('wp.video')}<input type="file" accept="video/mp4,video/webm" hidden data-testid="wp-upload-video" onchange={(e) => upload(e, 'video')} /></label>
      </div>
      {#if wp.kind === 'image' || wp.kind === 'video'}
        <button class="ox-btn small ghost danger" onclick={async () => { await deleteMedia(wp.kind as 'image' | 'video'); await setWp('kind', 'aurora'); }}>{t('common.delete')}</button>
      {/if}
      {#if uploadError}<p class="err">{uploadError}</p>{/if}
      <label class="ox-label">{t('wp.blur')} ({wp.blur}px)<input type="range" min="0" max="24" step="1" value={Number(wp.blur)} onchange={(e) => setWp('blur', Number((e.target as HTMLInputElement).value))} /></label>
      <label class="ox-label">{t('wp.dim')} ({wp.dim}%)<input type="range" min="0" max="80" step="5" value={Number(wp.dim)} onchange={(e) => setWp('dim', Number((e.target as HTMLInputElement).value))} /></label>
      {#if matchMedia('(prefers-reduced-motion: reduce)').matches}<p class="ox-muted small">{t('wp.reduced')}</p>{/if}
    {/if}
  </aside>
{/if}

<style>
  .page { position: relative; z-index: 1; min-height: 100vh; padding: 18px 32px 48px; max-width: 1240px; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6vh; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: 0.02em; opacity: 0.85; }
  .actions { display: flex; gap: 6px; }
  .actions a { text-decoration: none; }
  .grid { position: relative; width: 100%; transition: height calc(160ms * var(--ox-motion)) ease; }
  .widget { position: absolute; padding: 14px 16px; display: flex; flex-direction: column; overflow: hidden; transition: left calc(160ms * var(--ox-motion)) ease, top calc(160ms * var(--ox-motion)) ease, width calc(160ms * var(--ox-motion)) ease, height calc(160ms * var(--ox-motion)) ease; }
  .widget.type-search { padding: 0 14px; border-radius: 999px; }
  .widget.dragging { transition: none; z-index: 5; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); opacity: 0.92; }
  .body { flex: 1; min-height: 0; }
  .editing .widget { outline: 1px dashed color-mix(in srgb, var(--ox-accent) 40%, transparent); outline-offset: -1px; }
  .editing .widget.type-search { border-radius: calc(var(--ox-radius) + 4px); padding-top: 0; }
  .chrome { display: flex; justify-content: space-between; align-items: center; margin: -8px -8px 6px; padding: 2px 4px; cursor: grab; user-select: none; font-size: 12px; color: var(--ox-muted); touch-action: none; }
  .editing .type-search .chrome { margin: 2px -4px 0; }
  .resize { position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none; background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--ox-accent) 60%, transparent) 50%); border-radius: 0 0 8px 0; }
  .placeholder { position: absolute; border-radius: calc(var(--ox-radius) + 4px); background: color-mix(in srgb, var(--ox-accent) 10%, transparent); border: 1px dashed color-mix(in srgb, var(--ox-accent) 50%, transparent); }
  .settings { position: absolute; right: 8px; top: 34px; z-index: 3; width: 220px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .minimal { display: grid; place-items: center; gap: 12px; margin-top: 18vh; text-align: center; }
  .drawer { position: fixed; z-index: 10; top: 12px; right: 12px; bottom: 12px; width: 300px; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
  .dh { display: flex; justify-content: space-between; align-items: center; }
  h3 { margin: 8px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ox-muted); }
  .add-list { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .add-list .ox-btn { justify-content: flex-start; }
  .colors input[type='color'] { width: 40px; height: 30px; border: 1px solid var(--ox-border); background: transparent; border-radius: 8px; }
  .uploads { flex-wrap: wrap; }
  .err { color: #fca5a5; font-size: 12px; margin: 0; }
  .small { font-size: 12px; }
  @media (max-width: 760px) { .page { padding: 12px; } }
</style>
