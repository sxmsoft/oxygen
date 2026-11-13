/**
 * Command palette overlay. Plain DOM inside a closed shadow root so page CSS
 * can't leak in (or out). Used by the injected content script and by Oxygen's
 * own pages; all searching/acting happens in the service worker via messages.
 */
import type { PaletteItem } from '../features/palette.js';
import { translate, type Locale } from '../logic/i18n.js';
import { escapeHtml } from '../logic/markdown.js';

export interface PaletteOptions {
  locale: Locale;
  /** tab the palette acts on (popup window case); default = sender tab */
  tabId?: number;
  tokens?: Record<string, unknown>;
  /** called after closing (popup window closes itself) */
  onClose?: () => void;
  /** popup page: fill the window instead of floating */
  fullscreen?: boolean;
}

const HOST_ID = 'oxygen-palette-host';

const CSS = `
:host{all:initial}
.backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(3,4,6,.45);display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;font:14px/1.4 Inter,'Segoe UI',system-ui,sans-serif;color:var(--t);animation:fade .12s ease-out}
.fs.backdrop{padding:0;background:var(--bg);align-items:stretch}
.panel{width:min(640px,92vw);max-height:70vh;display:flex;flex-direction:column;background:var(--s);border:1px solid var(--b);border-radius:calc(var(--r) + 4px);box-shadow:0 24px 80px rgba(0,0,0,.55);overflow:hidden}
.fs .panel{width:100%;max-height:none;border:0;border-radius:0;box-shadow:none}
.top{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--b)}
.top svg{flex:none;opacity:.6}
input{all:unset;flex:1;font-size:16px;color:var(--t)}
input::placeholder{color:var(--m)}
kbd{font:11px ui-monospace,monospace;color:var(--m);border:1px solid var(--b);border-radius:5px;padding:1px 5px}
ul{list-style:none;margin:0;padding:6px;overflow:auto}
li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r);cursor:pointer}
li[aria-selected=true]{background:color-mix(in srgb,var(--a) 14%,transparent)}
.ic{width:18px;height:18px;flex:none;border-radius:4px;display:grid;place-items:center;font-size:12px;color:var(--a)}
.ic img{width:16px;height:16px}
.tx{min-width:0;flex:1}
.ti{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.su{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--m);font-size:12px}
.k{flex:none;font-size:11px;color:var(--m);border:1px solid var(--b);border-radius:999px;padding:1px 8px}
.empty{padding:18px;color:var(--m);text-align:center}
.toast{padding:8px 16px;border-top:1px solid var(--b);color:var(--m);font-size:12px}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.backdrop{animation:none}}
`;

const ICON: Record<string, string> = { command: '›', workspace: '▦', tab: '◻', bookmark: '★', history: '↺' };

export function isPaletteOpen(): boolean {
  return !!document.getElementById(HOST_ID);
}

export function closePalette(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function openPalette(opts: PaletteOptions): void {
  if (isPaletteOpen()) {
    closePalette();
    return;
  }
  const tr = (k: string, p?: Record<string, string | number>) => translate(opts.locale, k, p);
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-testid', 'oxygen-palette');
  const root = host.attachShadow({ mode: 'open' });
  const tk = opts.tokens ?? {};
  const vars = `--bg:${tk.surfacePrimary ?? '#07080b'};--s:${tk.surfaceElevated ?? '#101218'};--b:${tk.borderSubtle ?? '#222633'};--t:${tk.textPrimary ?? '#f3f5f8'};--m:${tk.textMuted ?? '#9aa3b2'};--a:${tk.accentColor ?? '#d8dee9'};--r:${tk.cornerRadiusPx ?? 10}px`;
  root.innerHTML = `<style>${CSS}</style>
  <div class="backdrop${opts.fullscreen ? ' fs' : ''}" style="${vars}">
    <div class="panel" role="dialog" aria-label="Oxygen">
      <div class="top">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="text" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(tr('palette.placeholder'))}" />
        <kbd>Esc</kbd>
      </div>
      <ul role="listbox"></ul>
      <div class="toast" hidden></div>
    </div>
  </div>`;
  const backdrop = root.querySelector('.backdrop') as HTMLElement;
  const input = root.querySelector('input') as HTMLInputElement;
  const list = root.querySelector('ul') as HTMLUListElement;
  const toast = root.querySelector('.toast') as HTMLElement;
  let items: PaletteItem[] = [];
  let sel = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    host.remove();
    document.removeEventListener('keydown', onDocKey, true);
    opts.onClose?.();
  };
  const render = () => {
    if (!items.length) {
      list.innerHTML = `<li class="empty" aria-disabled="true">${escapeHtml(tr('palette.empty'))}</li>`;
      return;
    }
    list.innerHTML = items
      .map(
        (it, i) => `<li role="option" data-i="${i}" data-kind="${it.kind}" aria-selected="${i === sel}">
          <span class="ic">${it.icon ? `<img src="${escapeHtml(it.icon)}" alt="">` : ICON[it.kind] ?? '•'}</span>
          <span class="tx"><div class="ti">${escapeHtml(it.title)}</div>${it.subtitle ? `<div class="su">${escapeHtml(it.subtitle)}</div>` : ''}</span>
          <span class="k">${escapeHtml(tr('palette.kind.' + it.kind))}</span></li>`
      )
      .join('');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  };
  const search = async () => {
    const my = ++seq;
    const res = (await chrome.runtime.sendMessage({ type: 'palette:search', q: input.value })) as PaletteItem[] | undefined;
    if (my !== seq) return;
    items = Array.isArray(res) ? res : [];
    sel = 0;
    render();
  };
  const run = async (i: number, newTab: boolean) => {
    const item = items[i];
    if (!item) return;
    const res = (await chrome.runtime.sendMessage({ type: 'palette:run', item, newTab, tabId: opts.tabId })) as
      | { ok: boolean; message?: string }
      | undefined;
    if (item.kind === 'command' && res?.message && !opts.fullscreen) {
      toast.hidden = false;
      toast.textContent = res.message;
      setTimeout(close, 900);
      return;
    }
    close();
  };
  const onDocKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 60);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void run(sel, e.shiftKey);
    }
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li[data-i]') as HTMLElement | null;
    if (li) void run(Number(li.dataset.i), (e as MouseEvent).shiftKey);
  });
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && !opts.fullscreen) close();
  });
  document.addEventListener('keydown', onDocKey, true);
  (document.body ?? document.documentElement).appendChild(host);
  input.focus();
  void search();
}
