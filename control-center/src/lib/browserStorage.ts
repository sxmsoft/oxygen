import type { ConfigStorageAdapter, OxygenConfigBundle } from '../../../oxygen-core/src/ConfigEngine.js';

const STORAGE_KEY = 'oxygen.control_center.config.v1';

export class BrowserConfigStorage implements ConfigStorageAdapter {
  read(): OxygenConfigBundle | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as OxygenConfigBundle) : null;
    } catch {
      return null;
    }
  }

  write(bundle: OxygenConfigBundle): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
    } catch {
      // Ignore storage quota errors in restricted sandboxes
    }
  }
}
