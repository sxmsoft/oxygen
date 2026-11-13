import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBrowserNtp, shouldSwapToOxygen } from '../../extension/src/logic/ntp.js';
import { isStampedBuild } from '../../extension/src/build.js';

test('only Helium’s own NTP is swapped, never Oxygen’s override or real pages', () => {
  assert.equal(isBrowserNtp('chrome://new-tab-page/'), true);
  assert.equal(isBrowserNtp('chrome://new-tab-page-third-party/'), true);
  assert.equal(isBrowserNtp('chrome-search://local-ntp/local-ntp.html'), true);
  assert.equal(isBrowserNtp('chrome://newtab/'), false, 'webNavigation reports this for Oxygen’s own tab');
  assert.equal(isBrowserNtp('chrome-extension://x/newtab.html'), false);
  assert.equal(isBrowserNtp('https://example.com/'), false);
  assert.equal(isBrowserNtp(undefined), false);
  const ntpTab = { url: 'chrome://newtab/' };
  assert.equal(shouldSwapToOxygen(ntpTab, 'chrome://new-tab-page/'), true);
  assert.equal(shouldSwapToOxygen({ ...ntpTab, incognito: true }, 'chrome://new-tab-page/'), false);
  assert.equal(shouldSwapToOxygen({ ...ntpTab, pendingUrl: 'https://typed.example/' }, 'chrome://new-tab-page/'), false, 'user is already navigating away');
  assert.equal(shouldSwapToOxygen({ url: 'https://example.com/' }, 'https://example.com/'), false);
});

test('unstamped dev builds never trigger the stale-worker fix', () => {
  assert.equal(isStampedBuild('__OXYGEN_BUILD__'), false);
  assert.equal(isStampedBuild(undefined), false);
  assert.equal(isStampedBuild('0.2.0.3'), true);
});
