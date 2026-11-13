import { barItems, ALL_BOOKMARKS_ID, type BookmarkNodeLike } from '../../../extension/src/logic/shortcuts.js';

export { ALL_BOOKMARKS_ID };
export type BookmarkNode = BookmarkNodeLike;

/** Live view of Helium's own bookmarks bar (nothing is copied; chrome.bookmarks is the store). */
export class BookmarkBar {
  items = $state<BookmarkNode[]>([]);
  ready = $state(false);
  #includeAll: boolean;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #reload = () => {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.load(), 60);
  };

  constructor(includeAll = true) {
    this.#includeAll = includeAll;
  }

  async load(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.bookmarks) {
      this.ready = true;
      return;
    }
    this.items = barItems((await chrome.bookmarks.getTree()) as BookmarkNode[], this.#includeAll);
    this.ready = true;
  }

  setIncludeAll(v: boolean): void {
    if (v === this.#includeAll) return;
    this.#includeAll = v;
    void this.load();
  }

  /** Subscribes to bookmark changes; returns the unsubscribe function. */
  watch(): () => void {
    void this.load();
    if (typeof chrome === 'undefined' || !chrome.bookmarks) return () => {};
    const b = chrome.bookmarks;
    const evs = [b.onCreated, b.onRemoved, b.onChanged, b.onMoved, b.onChildrenReordered, b.onImportEnded] as chrome.events.Event<() => void>[];
    for (const e of evs) e.addListener(this.#reload);
    return () => {
      clearTimeout(this.#timer);
      for (const e of evs) e.removeListener(this.#reload);
    };
  }
}
