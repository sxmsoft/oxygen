#!/usr/bin/env node
// End-to-end check of the built Oxygen extension + theme packs on headless Helium.
// Uses a throwaway profile; never touches the user's Helium profile or windows.
//
// Usage: node tests/e2e/verify_extension.mjs [--binary PATH] [--shots DIR]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, closeBrowser, sleep } from './cdp.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const binary = opt('--binary', process.env.HELIUM_BIN ?? '/opt/helium-browser-bin/helium');
const shots = resolve(opt('--shots', join(repo, 'dist/e2e')));
mkdirSync(shots, { recursive: true });

const extDir = join(repo, 'dist/extension');
// Chromium reliably keeps a single theme installed, so (like the launcher)
// each run loads exactly one theme pack.
const pack = (v) => join(repo, 'dist/themes', v);
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
const profile = mkdtempSync(join(tmpdir(), 'oxygen-e2e-'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function serviceWorker(cdp) {
  const t = await cdp.waitForTarget(
    (t) => t.type === 'service_worker' && t.url.endsWith('/background.js') && t.url.startsWith('chrome-extension://')
  );
  const session = await cdp.attach(t.targetId);
  await cdp.send('Runtime.runIfWaitingForDebugger', {}, session).catch(() => {});
  await cdp.waitFor(session, `typeof chrome !== 'undefined' && !!chrome.management`);
  return { target: t, session };
}

const ROOT_BG = `getComputedStyle(document.documentElement).getPropertyValue('--ox-bg').trim()`;
const oxygenThemes = `chrome.management.getAll().then(a => a.filter(e => e.type === 'theme' && e.name.startsWith('Oxygen Theme ')).map(e => ({name: e.name, enabled: e.enabled})))`;

let browser;
try {
  // ---- Run 1: fresh profile -------------------------------------------------
  browser = await launchBrowser({ binary, profileDir: profile, extensions: [extDir, pack('obsidian')] });
  let { cdp } = browser;
  let sw = await serviceWorker(cdp);
  const extId = new URL(sw.target.url).host;
  check('extension service worker running', true, sw.target.url);

  const swManifest = await cdp.evaluate(sw.session, 'chrome.runtime.getManifest().name + " " + chrome.runtime.getManifest().version_name');
  check('manifest loaded', swManifest.startsWith('Oxygen'), swManifest);

  // Theme sync is async (onInstalled -> storage -> management); poll up to 5 s.
  let themeState = [];
  for (let i = 0; i < 25; i++) {
    themeState = await cdp.evaluate(sw.session, oxygenThemes);
    if (themeState.some((t) => t.enabled)) break;
    await sleep(200);
  }
  check('theme pack installed', themeState.length === 1, JSON.stringify(themeState));
  check('default theme pack = Obsidian', themeState.filter((t) => t.enabled).map((t) => t.name).join() === 'Oxygen Theme Obsidian', JSON.stringify(themeState.filter((t) => t.enabled)));

  // New tab override
  const ntp = await cdp.openPage('chrome://newtab/');
  const ntpUrl = await cdp.waitFor(ntp.sessionId, `document.querySelector('.brand-title') && location.href`);
  check('new tab is Oxygen Control Center', ntpUrl.startsWith(`chrome-extension://${extId}/index.html`), ntpUrl);
  await sleep(400);
  writeFileSync(join(shots, '01-newtab-dashboard.png'), await cdp.screenshot(ntp.sessionId));

  // Options page via the same API the action button uses
  const pagesBefore = (await cdp.targets()).filter((t) => t.type === 'page').length;
  await cdp.evaluate(sw.session, `self.oxygenOpenControlCenter('modules').then(() => true)`);
  await sleep(1000);
  const pagesAfter = (await cdp.targets()).filter((t) => t.type === 'page');
  check('action/omnibox handler opens a Control Center tab (#modules)',
    pagesAfter.length === pagesBefore + 1 && pagesAfter.some((t) => t.url.endsWith(`${extId}/index.html#modules`)),
    pagesAfter.map((t) => t.url).join(' | '));

  // Appearance section via hash (what the `ox appearance` omnibox keyword opens)
  const app = await cdp.openPage(`chrome-extension://${extId}/index.html#appearance`);
  await cdp.waitFor(app.sessionId, `document.querySelector('select') !== null`);
  check('#appearance deep link opens Appearance section', true);

  const csp = await cdp.evaluate(app.sessionId, `document.querySelectorAll('script:not([src])').length`);
  check('no inline scripts on page (MV3 CSP)', csp === 0, `inline=${csp}`);

  // Change Surface Contrast in tab "app", observe in tab "ntp"
  await cdp.evaluate(app.sessionId, `(() => { const s = document.querySelector('select'); s.value = 'graphite'; s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  const bgA = await cdp.waitFor(app.sessionId, `${ROOT_BG} === '#13161C' && ${ROOT_BG}`);
  check('tab A applies graphite surface', bgA === '#13161C', bgA);
  const bgB = await cdp.waitFor(ntp.sessionId, `${ROOT_BG} === '#13161C' && ${ROOT_BG}`);
  check('tab B (new tab) synced via chrome.storage.onChanged', bgB === '#13161C', bgB);

  // Accent color change (Oxygen pages only)
  await cdp.evaluate(app.sessionId, `(() => { const b = document.querySelector('button[aria-label="Accent #6EE7B7"]'); b.click(); return true; })()`);
  const accB = await cdp.waitFor(ntp.sessionId, `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent').trim() === '#6EE7B7'`);
  check('accent change synced to other tab', accB === true);

  const hint = await cdp.waitFor(app.sessionId, `(document.querySelector('[data-testid=theme-pack-status]')?.textContent ?? '').includes('--theme graphite') && document.querySelector('[data-testid=theme-pack-status]').textContent.replace(/\\s+/g,' ').trim()`);
  check('Graphite pack not loaded -> Control Center shows launcher hint', true, hint);
  themeState = await cdp.evaluate(sw.session, oxygenThemes);
  check('browser theme left on Obsidian (no live swap possible)', themeState.filter((t) => t.enabled).map((t) => t.name).join() === 'Oxygen Theme Obsidian', JSON.stringify(themeState));
  writeFileSync(join(shots, '02-appearance-graphite.png'), await cdp.screenshot(app.sessionId));

  const stored = await cdp.evaluate(sw.session, `chrome.storage.local.get('oxygen.config.v1').then(r => r['oxygen.config.v1'].modules['core-theme-obsidian'])`);
  check('config persisted in chrome.storage.local', stored.surfaceContrast === 'graphite' && stored.accentColor === '#6EE7B7', JSON.stringify(stored));

  await closeBrowser(browser);
  browser = null;

  // ---- Run 2: same profile, restart with the Graphite pack (oxygen.sh run --theme graphite)
  browser = await launchBrowser({ binary, profileDir: profile, extensions: [extDir, pack('graphite')] });
  cdp = browser.cdp;
  sw = await serviceWorker(cdp);
  const run2 = await cdp.openPage(`chrome-extension://${extId}/index.html#appearance`);
  const bgR = await cdp.waitFor(run2.sessionId, `${ROOT_BG} === '#13161C' && ${ROOT_BG}`);
  check('settings persist across browser restart', bgR === '#13161C', bgR);
  const selR = await cdp.evaluate(run2.sessionId, `document.querySelector('select').value`);
  check('Surface Contrast select restored', selR === 'graphite', selR);
  await sleep(800);
  themeState = await cdp.evaluate(sw.session, oxygenThemes);
  check('restart with Graphite pack -> Graphite browser theme active', themeState.filter((t) => t.enabled).map((t) => t.name).join() === 'Oxygen Theme Graphite', JSON.stringify(themeState));

  await closeBrowser(browser);
  browser = null;

  // ---- Run 3: restart with the Midnight pack -> config adopts the launcher's choice
  browser = await launchBrowser({ binary, profileDir: profile, extensions: [extDir, pack('midnight')] });
  cdp = browser.cdp;
  sw = await serviceWorker(cdp);
  await sleep(1000);
  const adopted = await cdp.evaluate(sw.session, `chrome.storage.local.get('oxygen.config.v1').then(r => r['oxygen.config.v1'].modules['core-theme-obsidian'])`);
  check('launcher pack (midnight) adopted into config, other settings kept', adopted.surfaceContrast === 'midnight' && adopted.accentColor === '#6EE7B7', JSON.stringify(adopted));
  const again = await cdp.openPage(`chrome-extension://${extId}/index.html#appearance`);
  const bgM = await cdp.waitFor(again.sessionId, `${ROOT_BG} === '#080C16' && ${ROOT_BG}`);
  check('Control Center follows adopted Midnight surface', bgM === '#080C16', bgM);
  writeFileSync(join(shots, '04-appearance-midnight.png'), await cdp.screenshot(again.sessionId));

  // Disable theme module -> all Oxygen theme packs off (Helium default)
  await cdp.evaluate(again.sessionId, `(() => { location.hash = '#modules'; return true; })()`);
  await cdp.waitFor(again.sessionId, `document.querySelector('.toggle-btn') !== null`);
  await cdp.evaluate(again.sessionId, `(() => { const items = [...document.querySelectorAll('.module-item')]; const it = items.find(i => i.textContent.includes('Obsidian Metallic')); it.querySelector('.toggle-btn').click(); return true; })()`);
  for (let i = 0; i < 25; i++) {
    themeState = await cdp.evaluate(sw.session, oxygenThemes);
    if (themeState.every((t) => !t.enabled)) break;
    await sleep(200);
  }
  const ids = await cdp.evaluate(sw.session, `chrome.storage.local.get('oxygen.config.v1').then(r => r['oxygen.config.v1'].enabledModuleIds)`);
  check('disabling theme module reverts to Helium default theme', themeState.every((t) => !t.enabled), JSON.stringify({ themeState, enabledModuleIds: ids }));
  writeFileSync(join(shots, '03-modules.png'), await cdp.screenshot(again.sessionId));
} catch (err) {
  let dump = '';
  try {
    const t = (await browser.cdp.targets()).find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
    const sess = await browser.cdp.attach(t.targetId);
    dump = JSON.stringify(await browser.cdp.evaluate(sess, 'chrome.storage.local.get(null)'));
  } catch {}
  check('unexpected error', false, (err.stack ?? String(err)) + (dump ? '\n  storage: ' + dump : ''));
} finally {
  if (browser) await closeBrowser(browser);
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${shots}`);
process.exit(failed.length ? 1 : 0);
