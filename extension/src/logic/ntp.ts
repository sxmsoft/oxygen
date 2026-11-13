/**
 * Helium/Chromium's own new tab page. Extensions loaded with --load-extension
 * register their chrome_url_overrides only after the first window's tab has
 * already committed this page, so Oxygen swaps such startup tabs.
 */
// Not chrome://newtab/ itself: that is also what webNavigation reports for Oxygen's own override.
const BROWSER_NTP = [/^chrome:\/\/new-tab-page(-third-party)?\//, /^chrome-search:\/\/local-ntp\//];

/** `committedUrl` is the frame's real URL (webNavigation), not the tab's virtual chrome://newtab/. */
export function isBrowserNtp(committedUrl: string | undefined): boolean {
  return !!committedUrl && BROWSER_NTP.some((r) => r.test(committedUrl));
}

/** Only tabs still showing the browser NTP (never a page the user navigated to) are swapped. */
export function shouldSwapToOxygen(tab: { url?: string; pendingUrl?: string; incognito?: boolean }, committedUrl: string | undefined): boolean {
  if (tab.incognito) return false;
  if (tab.pendingUrl && !isBrowserNtp(tab.pendingUrl) && tab.pendingUrl !== 'chrome://newtab/') return false;
  return isBrowserNtp(committedUrl);
}
