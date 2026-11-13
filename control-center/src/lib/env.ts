import type { OxygenCore } from '../../../oxygen-core/src/OxygenCore.js';
import { ChromeStorageAdapter } from '../../../oxygen-core/src/ChromeStorageAdapter.js';
import { ExtensionBridge, isExtensionContext } from '../../../extension/src/bridge.js';
import { BrowserConfigStorage } from './browserStorage';
import { createCore } from './createCore';
import { THEME_PACK_STATUS_KEY, type ThemePackStatus } from '../../../extension/src/shared.js';

export interface RuntimeInfo {
  extensionVersion: string | null;
  extensionId: string | null;
  browser: string;
}

export interface OxygenEnvironment {
  core: OxygenCore;
  mode: 'extension' | 'standalone';
  /** Called after another tab / context changed the config and core was updated. */
  onExternalChange(cb: () => void): () => void;
  runtimeInfo(): Promise<RuntimeInfo>;
  /** Browser theme pack state reported by the service worker (extension only). */
  onThemePackStatus(cb: (status: ThemePackStatus | null) => void): () => void;
}

interface UADataLike {
  brands?: Array<{ brand: string; version: string }>;
  getHighEntropyValues?(hints: string[]): Promise<{
    fullVersionList?: Array<{ brand: string; version: string }>;
  }>;
}

async function detectBrowser(): Promise<string> {
  const ua = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  let list = ua?.brands ?? [];
  try {
    const hi = await ua?.getHighEntropyValues?.(['fullVersionList']);
    if (hi?.fullVersionList?.length) list = hi.fullVersionList;
  } catch {
    // high-entropy hints unavailable
  }
  // Helium reports a "Google Chrome" brand for compatibility; the engine brand is what we show.
  const chromium = list.find((b) => b.brand === 'Chromium');
  if (chromium) return `Chromium ${chromium.version}`;
  const m = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
  return m ? `Chromium ${m[1]}` : navigator.userAgent;
}

export async function createEnvironment(): Promise<OxygenEnvironment> {
  if (isExtensionContext()) {
    const adapter = await ChromeStorageAdapter.create(chrome.storage.local);
    const core = createCore(adapter, new ExtensionBridge());
    const listeners = new Set<() => void>();
    adapter.subscribe(chrome.storage.onChanged, 'local', async (bundle) => {
      await core.applyExternalBundle(bundle);
      for (const l of listeners) l();
    });
    return {
      core,
      mode: 'extension',
      onExternalChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      onThemePackStatus(cb) {
        void chrome.storage.local
          .get(THEME_PACK_STATUS_KEY)
          .then((r) => cb((r[THEME_PACK_STATUS_KEY] as ThemePackStatus) ?? null));
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
          if (area === 'local' && THEME_PACK_STATUS_KEY in changes) {
            cb((changes[THEME_PACK_STATUS_KEY].newValue as ThemePackStatus) ?? null);
          }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
      },
      async runtimeInfo() {
        const m = chrome.runtime.getManifest();
        return {
          extensionVersion: m.version_name ?? m.version,
          extensionId: chrome.runtime.id ?? null,
          browser: await detectBrowser(),
        };
      },
    };
  }

  const core = createCore(new BrowserConfigStorage());
  return {
    core,
    mode: 'standalone',
    onExternalChange: () => () => {},
    onThemePackStatus: (cb) => {
      cb(null);
      return () => {};
    },
    async runtimeInfo() {
      return { extensionVersion: null, extensionId: null, browser: await detectBrowser() };
    },
  };
}
