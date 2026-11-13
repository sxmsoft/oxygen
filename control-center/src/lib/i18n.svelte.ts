import type { OxygenCore } from '../../../oxygen-core/src/OxygenCore.js';
import { resolveLocale, translate, type Locale, type MessageKey } from '../../../extension/src/logic/i18n.js';

/** Reactive UI language for Svelte pages: global "language" setting, default = browser locale. */
class I18n {
  locale = $state<Locale>('en');

  sync(core: OxygenCore): void {
    const pref = core.config.getGlobal().language;
    const uiLang = typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage ? chrome.i18n.getUILanguage() : navigator.language;
    this.locale = resolveLocale(pref, uiLang);
    document.documentElement.lang = this.locale;
  }

  t = (key: MessageKey | string, params?: Record<string, string | number>): string => translate(this.locale, key, params);
}

export const i18n = new I18n();
