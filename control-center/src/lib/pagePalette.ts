import type { OxygenCore } from '../../../oxygen-core/src/OxygenCore.js';
import { openPalette } from '../../../extension/src/ui/paletteOverlay.js';
import { i18n } from './i18n.svelte';

/**
 * Oxygen pages render the palette themselves: Ctrl+K works in-page (a browser
 * shortcut can't be claimed from an extension page), and the global command
 * (default Alt+K) reaches us as a runtime message.
 */
export function installPagePalette(core: OxygenCore): void {
  const enabled = () => core.modules.listModules().find((m) => m.manifest.id === 'command-palette')?.enabled ?? true;
  const open = () => {
    if (!enabled()) return;
    openPalette({ locale: i18n.locale, tokens: { ...core.getActiveThemeTokens() } });
  };
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open();
    }
  });
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'palette:open') return;
    void chrome.tabs.getCurrent().then((tab) => {
      if (tab?.id === msg.tabId) open();
    });
  });
}
