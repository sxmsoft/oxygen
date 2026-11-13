import { OXYGEN_BUILD, SW_HEALED_KEY, isStampedBuild } from '../build.js';

/**
 * Chromium keeps an extension's service worker scripts across restarts and
 * only refreshes them on an extension reload, which would disable a
 * command-line extension when Developer mode is off. Unregistering the stale
 * registration is safe: Chromium registers the current files on the next
 * start. Done at most once per manifest version.
 */
async function unregisterOncePerVersion(version: string): Promise<boolean> {
  const done = (await chrome.storage.local.get(SW_HEALED_KEY))[SW_HEALED_KEY];
  if (done === version) return false;
  await chrome.storage.local.set({ [SW_HEALED_KEY]: version });
  const reg = await (globalThis as { registration?: ServiceWorkerRegistration }).registration ??
    (await navigator.serviceWorker?.getRegistration?.());
  return (await reg?.unregister()) ?? false;
}

/** In the service worker: am I older than the files on disk? */
export async function healSelfIfStale(): Promise<boolean> {
  const version = chrome.runtime.getManifest().version;
  if (!isStampedBuild(OXYGEN_BUILD) || OXYGEN_BUILD === version) return false;
  return unregisterOncePerVersion(version);
}

/** In an extension page (always loaded fresh from disk): is the running service worker an older build? */
export async function healStaleServiceWorker(): Promise<'ok' | 'healed' | 'unknown'> {
  const version = chrome.runtime.getManifest().version;
  if (!isStampedBuild(OXYGEN_BUILD)) return 'unknown'; // dev build
  let stale = false;
  try {
    const r = (await chrome.runtime.sendMessage({ type: 'oxygen:build' })) as { build?: string } | undefined;
    stale = r?.build !== version;
  } catch (e) {
    // An older worker has a listener but no answer for 'oxygen:build'.
    stale = /message port closed/i.test(String((e as Error)?.message ?? e));
  }
  if (!stale) return 'ok';
  return (await unregisterOncePerVersion(version)) ? 'healed' : 'unknown';
}
