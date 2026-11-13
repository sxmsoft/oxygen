<script lang="ts">
  import { onMount } from 'svelte';
  import type { OxygenEnvironment } from '../lib/env';
  import { i18n } from '../lib/i18n.svelte';
  import { StoredValue } from '../lib/kv.svelte';
  import { moduleCfg, moduleOn } from '../lib/modules';
  import { installPagePalette } from '../lib/pagePalette';
  import {
    addWidget, layoutHeight, moveWidget, parseLayout, removeWidget, rescaleLayout, resizeWidget, updateWidgetSettings, type Layout,
  } from '../../../extension/src/logic/layout.js';
  import { DEFAULT_GRID, PRESETS, effectiveRowHeight, frameOf, parseGrid, type GridConfig } from '../../../extension/src/logic/gridConfig.js';
  import { ADDED_WIDGETS, WIDGETS, defaultCity, defaultLayout, defaultSettings, widgetDef } from './widgets';
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
  const legacyRowH = $derived(track(rev, Number(moduleCfg<{ rowHeight: number }>(core, 'newtab-widgets').rowHeight) || 84));
  const gridStored = new StoredValue<unknown>('oxygen.newtab.grid', null);
  const g = $derived<GridConfig>(parseGrid(gridStored.value, legacyRowH));
  const cols = $derived(g.columns);
  const GAP = $derived(g.gap);
  let vh = $state(900);
  const rowH = $derived(effectiveRowHeight(g, vh, 18 + (g.showHeader ? 52 : 0) + (vh * g.topSpace) / 100));
  const accent = $derived(track(rev, core.getActiveThemeTokens().accentColor ?? '#d8dee9'));

  const stored = new StoredValue<unknown>('oxygen.newtab.layout', null);
  const layout = $derived<Layout>(stored.ready && gridStored.ready ? parseLayout(stored.value, WIDGETS, cols) ?? defaultLayout(i18n.locale) : []);
  let preview = $state<Layout | null>(null);
  const shown = $derived(preview ?? layout);

  let editing = $state(false);
  let drawer = $state(false);
  let settingsFor = $state<string | null>(null);
  let gridEl = $state<HTMLDivElement | null>(null);
  let gridW = $state(1100);
  const colW = $derived((gridW - GAP * (cols - 1)) / cols);
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

  // Layouts saved before a widget type existed get it once (e.g. the bookmarks bar).
  let migrated = false;
  $effect(() => {
    if (!stored.ready || !gridStored.ready || migrated || typeof chrome === 'undefined' || !chrome.storage) return;
    migrated = true;
    const saved = parseLayout(stored.value, WIDGETS, cols);
    void chrome.storage.local.get(ADDED_WIDGETS.map((a) => a.flag)).then((flags) => {
      let next = saved;
      for (const a of ADDED_WIDGETS) {
        if (flags[a.flag]) continue;
        if (next && !next.some((w) => w.type === a.type)) next = addWidget(next, a.type, WIDGETS, `w-${a.type}`, defaultSettings(a.type), cols);
        void chrome.storage.local.set({ [a.flag]: true });
      }
      if (next && next !== saved) commit(next);
    });
  });
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
      preview = moveWidget(layout, drag.id, x, Math.max(0, y), WIDGETS, cols);
    } else {
      const w = Math.round((drag.px - item.x * (colW + GAP) + GAP) / (colW + GAP));
      const h = Math.round((drag.py - item.y * (rowH + GAP) + GAP) / (rowH + GAP));
      preview = resizeWidget(layout, drag.id, w, h, WIDGETS, cols);
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
    commit(e.shiftKey ? resizeWidget(layout, id, p.w + d[0], p.h + d[1], WIDGETS, cols) : moveWidget(layout, id, p.x + d[0], Math.max(0, p.y + d[1]), WIDGETS, cols));
  }
  function add(type: string) {
    commit(addWidget(layout, type, WIDGETS, `w-${type}-${Date.now().toString(36)}`, defaultSettings(type), cols));
  }

  // ---- grid look & presets ----
  let undo = $state<{ layout: Layout; grid: unknown } | null>(null);
  function setGrid(patch: Partial<GridConfig>, debounce = 0) {
    gridStored.set({ ...$state.snapshot(g), ...patch }, debounce);
  }
  function setColumns(n: number) {
    const next = parseGrid({ ...g, columns: n }).columns;
    if (next === cols) return;
    commit(rescaleLayout(layout, cols, next, WIDGETS));
    setGrid({ columns: next });
  }
  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    undo = { layout: JSON.parse(JSON.stringify(layout)), grid: $state.snapshot(gridStored.value) };
    gridStored.set({ ...DEFAULT_GRID, rowHeight: legacyRowH, ...p.grid });
    commit(p.layout(defaultCity(i18n.locale)));
  }
  function undoPreset() {
    if (!undo) return;
    gridStored.set(undo.grid as GridConfig);
    commit(undo.layout);
    undo = null;
  }
  function resetAll() {
    undo = { layout: JSON.parse(JSON.stringify(layout)), grid: $state.snapshot(gridStored.value) };
    gridStored.set({ ...DEFAULT_GRID });
    commit(defaultLayout(i18n.locale));
  }
  const pageStyle = $derived(
    `max-width:${g.maxWidth ? g.maxWidth + 'px' : 'none'};margin:${g.align === 'center' ? '0 auto' : g.align === 'end' ? '0 0 0 auto' : '0'}`,
  );
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

<svelte:window bind:innerHeight={vh} onpointermove={onMove} onpointerup={endDrag} onpointercancel={endDrag} />

{#if wallpaperOn}<Wallpaper cfg={wp} {accent} />{/if}

<div class="page" class:editing data-testid="newtab" style={pageStyle} data-columns={cols}>
  <header class="top" class:bare={!g.showHeader && !editing} style="margin-bottom:{g.topSpace}vh">
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
          class="widget type-{w.type} frame-{frameOf(w.settings, g)}"
          class:ox-glass={frameOf(w.settings, g) === 'glass'}
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
                {#if def}<button class="ox-icon-btn" aria-label={t('common.settings')} onpointerdown={(e) => e.stopPropagation()} onclick={() => (settingsFor = settingsFor === w.id ? null : w.id)}>⚙</button>{/if}
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
                  <label class="ox-label">{t(s.label)}<select class="ox-select" data-setting={s.key} value={String(w.settings[s.key] ?? s.default)} onchange={(e) => setWidgetSetting(w.id, s.key, (e.target as HTMLSelectElement).value)}>{#each s.options ?? [] as o}<option value={o.value}>{t(o.label)}</option>{/each}</select></label>
                {:else if s.type === 'range'}
                  {@const v = Number(w.settings[s.key] ?? s.default)}
                  <label class="ox-label">{t(s.label)} ({v}{s.unit ?? ''})<input type="range" data-setting={s.key} min={s.min} max={s.max} step={s.step} value={v} onchange={(e) => setWidgetSetting(w.id, s.key, Number((e.target as HTMLInputElement).value))} /></label>
                {:else}
                  <label class="ox-label">{t(s.label)}<input class="ox-input" value={String(w.settings[s.key] ?? s.default)} onchange={(e) => setWidgetSetting(w.id, s.key, (e.target as HTMLInputElement).value)} /></label>
                {/if}
              {/each}
              <label class="ox-label">{t('w.frame')}<select class="ox-select" data-setting="frame" value={String(w.settings.frame ?? '')} onchange={(e) => setWidgetSetting(w.id, 'frame', (e.target as HTMLSelectElement).value || undefined)}>
                <option value="">{t('frame.default')}</option>{#each ['glass', 'solid', 'none'] as f}<option value={f}>{t('frame.' + f)}</option>{/each}
              </select></label>
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

      <h3>{t('nt.layout')}</h3>
      <div class="ox-label">{t('nt.presets')}
        <div class="presets">
          {#each PRESETS as p}<button class="ox-btn small" data-testid="preset-{p.id}" onclick={() => applyPreset(p.id)}>{t('nt.preset.' + p.id)}</button>{/each}
          {#if undo}<button class="ox-btn small ghost" data-testid="preset-undo" onclick={undoPreset}>↶ {t('nt.undo')}</button>{/if}
        </div>
      </div>
      <div class="layout-panel" data-testid="layout-panel">
        <label class="ox-label">{t('grid.columns')} ({cols})<input type="range" data-testid="grid-columns" min="4" max="24" step="1" value={cols} onchange={(e) => setColumns(Number((e.target as HTMLInputElement).value))} /></label>
        <label class="ox-label">{t('grid.rowMode')}
          <select class="ox-select" data-testid="grid-rowmode" value={g.rowMode} onchange={(e) => setGrid({ rowMode: (e.target as HTMLSelectElement).value as GridConfig['rowMode'] })}>
            <option value="fixed">{t('grid.fixed')}</option><option value="fit">{t('grid.fit')}</option>
          </select>
        </label>
        {#if g.rowMode === 'fixed'}
          <label class="ox-label">{t('grid.rowHeight')} ({g.rowHeight}px)<input type="range" data-testid="grid-rowheight" min="40" max="160" step="4" value={g.rowHeight} oninput={(e) => setGrid({ rowHeight: Number((e.target as HTMLInputElement).value) }, 150)} /></label>
        {:else}
          <label class="ox-label">{t('grid.rows')} ({g.rows})<input type="range" data-testid="grid-rows" min="4" max="16" step="1" value={g.rows} oninput={(e) => setGrid({ rows: Number((e.target as HTMLInputElement).value) }, 150)} /></label>
        {/if}
        <label class="ox-label">{t('grid.gap')} ({g.gap}px)<input type="range" data-testid="grid-gap" min="0" max="40" step="2" value={g.gap} oninput={(e) => setGrid({ gap: Number((e.target as HTMLInputElement).value) }, 150)} /></label>
        <label class="ox-label">{t('grid.maxWidth')} ({g.maxWidth ? g.maxWidth + 'px' : t('grid.full')})<input type="range" data-testid="grid-maxwidth" min="440" max="2400" step="40" value={g.maxWidth || 440} oninput={(e) => { const v = Number((e.target as HTMLInputElement).value); setGrid({ maxWidth: v <= 440 ? 0 : v }, 150); }} /></label>
        <label class="ox-label">{t('grid.align')}
          <select class="ox-select" data-testid="grid-align" value={g.align} onchange={(e) => setGrid({ align: (e.target as HTMLSelectElement).value as GridConfig['align'] })}>
            <option value="center">{t('grid.alignCenter')}</option><option value="start">{t('grid.alignStart')}</option><option value="end">{t('grid.alignEnd')}</option>
          </select>
        </label>
        <label class="ox-label">{t('grid.topSpace')} ({g.topSpace}vh)<input type="range" data-testid="grid-topspace" min="0" max="40" step="1" value={g.topSpace} oninput={(e) => setGrid({ topSpace: Number((e.target as HTMLInputElement).value) }, 150)} /></label>
        <label class="ox-label">{t('grid.frames')}
          <select class="ox-select" data-testid="grid-frames" value={g.frames} onchange={(e) => setGrid({ frames: (e.target as HTMLSelectElement).value as GridConfig['frames'] })}>
            {#each ['glass', 'solid', 'none'] as f}<option value={f}>{t('frame.' + f)}</option>{/each}
          </select>
        </label>
        <label class="ox-check"><input type="checkbox" data-testid="grid-header" checked={g.showHeader} onchange={(e) => setGrid({ showHeader: (e.target as HTMLInputElement).checked })} />{t('grid.showHeader')}</label>
      </div>
      <button class="ox-btn small ghost danger" data-testid="reset-all" onclick={resetAll}>{t('nt.resetAll')}</button>
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
  .page { position: relative; z-index: 1; min-height: 100vh; padding: 18px 32px 48px; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  .top.bare { position: fixed; top: 10px; right: 14px; z-index: 6; margin: 0 !important; }
  .top.bare .brand { display: none; }
  .top.bare .actions { opacity: 0.12; transition: opacity 160ms; }
  .top.bare:hover .actions, .top.bare:focus-within .actions { opacity: 1; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: 0.02em; opacity: 0.85; }
  .actions { display: flex; gap: 6px; }
  .actions a { text-decoration: none; }
  .grid { position: relative; width: 100%; transition: height calc(160ms * var(--ox-motion)) ease; }
  .widget { position: absolute; padding: 14px 16px; display: flex; flex-direction: column; overflow: hidden; transition: left calc(160ms * var(--ox-motion)) ease, top calc(160ms * var(--ox-motion)) ease, width calc(160ms * var(--ox-motion)) ease, height calc(160ms * var(--ox-motion)) ease; }
  .widget.type-search { padding: 0 14px; border-radius: 999px; }
  .widget.frame-solid { background: var(--ox-surface); border: 1px solid var(--ox-border); border-radius: calc(var(--ox-radius) + 4px); }
  .widget.frame-none { background: none; border: 0; box-shadow: none; padding-left: 4px; padding-right: 4px; }
  .widget.frame-none.type-search { padding: 0 14px; background: color-mix(in srgb, var(--ox-text) 6%, transparent); }
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
  .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .layout-panel { display: flex; flex-direction: column; gap: 10px; }
  .layout-panel input[type='range'] { width: 100%; }
  .colors input[type='color'] { width: 40px; height: 30px; border: 1px solid var(--ox-border); background: transparent; border-radius: 8px; }
  .uploads { flex-wrap: wrap; }
  .err { color: #fca5a5; font-size: 12px; margin: 0; }
  .small { font-size: 12px; }
  @media (max-width: 760px) { .page { padding: 12px; } }
</style>
