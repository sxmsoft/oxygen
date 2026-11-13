// Popup-window palette, used when the shortcut fires on a page where scripts
// can't be injected (chrome:// pages, the Web Store, …).
import '../app.css';
import { openPalette } from '../../../extension/src/ui/paletteOverlay.js';
import { resolveLocale } from '../../../extension/src/logic/i18n.js';

void (async () => {
  const tabId = Number(new URLSearchParams(location.search).get('tab')) || undefined;
  const got = await chrome.storage.local.get(['oxygen.config.v1', 'oxygen.theme.tokens']);
  const cfg = got['oxygen.config.v1'] as { global?: { language?: unknown } } | undefined;
  openPalette({
    locale: resolveLocale(cfg?.global?.language, chrome.i18n.getUILanguage()),
    tokens: got['oxygen.theme.tokens'] as Record<string, unknown> | undefined,
    tabId,
    fullscreen: true,
    onClose: () => window.close(),
  });
})();
