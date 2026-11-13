import type { ThemeTokens } from '../../sdk/src/types.js';

export interface NativeBridge {
  readonly isChromiumWebUI: boolean;
  pushThemeTokens(tokens: Partial<ThemeTokens>): void;
  pushPref(key: string, value: unknown): void;
}

declare global {
  interface Window {
    chrome?: {
      send?: (message: string, args?: unknown[]) => void;
    };
  }
}

export class ChromiumNativeBridge implements NativeBridge {
  get isChromiumWebUI(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.chrome?.send === 'function'
    );
  }

  pushThemeTokens(tokens: Partial<ThemeTokens>): void {
    if (this.isChromiumWebUI) {
      window.chrome!.send!('oxygenSetThemeTokens', [tokens]);
    }
  }

  pushPref(key: string, value: unknown): void {
    if (this.isChromiumWebUI) {
      window.chrome!.send!('oxygenSetPref', [key, value]);
    }
  }
}
