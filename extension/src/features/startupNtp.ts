import { shouldSwapToOxygen } from '../logic/ntp.js';

/**
 * Replaces Helium's own NTP in tabs opened before Oxygen's new-tab override
 * was registered (first window after a start). Navigates to chrome://newtab/,
 * which now resolves to Oxygen, so the omnibox stays clean and the tab's
 * history is kept. Runs a bounded number of times; never loops.
 */
export async function swapStartupNtps(): Promise<number> {
  let swapped = 0;
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === undefined) continue;
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
    if (!shouldSwapToOxygen(tab, frame?.url)) continue;
    await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' }).then(() => swapped++, () => {});
  }
  return swapped;
}

/** Startup: now, and once more shortly after (the window may still be opening its first tab). */
export function swapStartupNtpsSoon(): void {
  void swapStartupNtps();
  setTimeout(() => void swapStartupNtps(), 1500);
}
