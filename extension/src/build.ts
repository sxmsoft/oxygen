/**
 * Build id, replaced with the manifest version by scripts/stamp_version.mjs.
 * Lets pages and the service worker notice a service worker that Chromium kept
 * from an older build (it does that for --load-extension / unpacked installs).
 */
export const OXYGEN_BUILD: string = '__OXYGEN_BUILD__';
export const isStampedBuild = (b: string | undefined): b is string => !!b && !b.startsWith('__OXYGEN');
export const SW_HEALED_KEY = 'oxygen.sw.healed';
