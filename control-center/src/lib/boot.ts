import { mount, type Component } from 'svelte';
import '../app.css';
import './ui.css';
import { createEnvironment, type OxygenEnvironment } from './env';
import { applyTokensToDocument } from './theme';
import { i18n } from './i18n.svelte';
import { healStaleServiceWorker } from '../../../extension/src/features/swHeal.js';

/** Shared bootstrap for Oxygen pages: config core, theme tokens, language. */
export async function bootPage(App: Component<{ env: OxygenEnvironment }>): Promise<void> {
  const env = await createEnvironment();
  await env.core.init();
  applyTokensToDocument(env.core.getActiveThemeTokens());
  i18n.sync(env.core);
  env.onExternalChange(() => {
    applyTokensToDocument(env.core.getActiveThemeTokens());
    i18n.sync(env.core);
  });
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) void healStaleServiceWorker().catch(() => {});
  mount(App, { target: document.getElementById('app')!, props: { env } });
}
