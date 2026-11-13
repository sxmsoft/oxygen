import type { ThemeTokens } from '../../sdk/src/types.js';

/**
 * Where Oxygen Core is running:
 * - `extension`: inside the Oxygen MV3 extension on top of Helium
 * - `standalone`: plain web page / tests (no browser integration)
 */
export type BridgeMode = 'extension' | 'standalone';

/**
 * Integration point between Oxygen Core and the host browser.
 * The extension implementation lives in `extension/src/bridge.ts`.
 */
export interface NativeBridge {
  readonly mode: BridgeMode;
  pushThemeTokens(tokens: Partial<ThemeTokens>): void;
  pushPref(key: string, value: unknown): void;
}

export class NoopBridge implements NativeBridge {
  readonly mode = 'standalone' as const;
  pushThemeTokens(): void {}
  pushPref(): void {}
}
