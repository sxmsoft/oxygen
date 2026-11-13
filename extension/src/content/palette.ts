// Injected on demand by the service worker (chrome.scripting.executeScript) when the
// palette shortcut is pressed on a web page. Not a persistent content script.
import { openPalette } from '../ui/paletteOverlay.js';
import { resolveLocale } from '../logic/i18n.js';

void (async () => {
  const got = await chrome.storage.local.get(['oxygen.config.v1', 'oxygen.theme.tokens']);
  const cfg = got['oxygen.config.v1'] as { global?: { language?: unknown } } | undefined;
  openPalette({
    locale: resolveLocale(cfg?.global?.language, chrome.i18n.getUILanguage()),
    tokens: got['oxygen.theme.tokens'] as Record<string, unknown> | undefined,
  });
})();
