import type { ThemeTokens } from '../../../sdk/src/types.js';

export function applyTokensToDocument(tokens: Partial<ThemeTokens>, root: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string | undefined) => v && root.style.setProperty(k, v);
  set('--ox-bg', tokens.surfacePrimary);
  set('--ox-surface', tokens.surfaceElevated);
  set('--ox-toolbar', tokens.surfaceToolbar);
  set('--ox-omnibox', tokens.surfaceOmnibox);
  set('--ox-border', tokens.borderSubtle);
  set('--ox-text', tokens.textPrimary);
  set('--ox-muted', tokens.textMuted);
  set('--ox-accent', tokens.accentColor);
  if (tokens.cornerRadiusPx !== undefined) root.style.setProperty('--ox-radius', `${tokens.cornerRadiusPx}px`);
  if (tokens.motionScale !== undefined) root.style.setProperty('--ox-motion', String(tokens.motionScale));
}
