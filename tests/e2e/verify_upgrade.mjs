#!/usr/bin/env node
// Headless e2e for an *already used* profile, the way Enes runs Oxygen
// (--load-extension from a fixed folder whose files get replaced):
//  1. install the old 0.2.0 build (c9e1c36), use it (settings, links, layout)
//  2. replace the folder with the current build + a Helium shortcut import, restart:
//     Chromium keeps the old service worker -> pages must still import, keep the
//     user's state and unregister the stale worker
//  3. restart again: the fresh worker swaps the startup tab (Helium NTP) to Oxygen
//  4. restart with --restore-last-session: restored web tabs are left alone
//
// Usage: node tests/e2e/verify_upgrade.mjs [--binary PATH] [--old-ref REF]
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
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
const oldExt = execFileSync(join(repo, 'scripts/build_old.sh'), [opt('--old-ref', 'c9e1c36')], { encoding: 'utf8' }).trim().split('\n').pop();

const results = [];
function check(name, ok, detail = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok: !!ok, detail: d });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name}: unexpected error`, false, e.stack ?? String(e));
  }
}

const work = mkdtempSync(join(tmpdir(), 'oxygen-e2e-upgrade-'));
const extDir = join(work, 'extension'); // fixed path, files replaced in place (like dist/extension)
const profile = join(work, 'profile');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Restored ${req.url}</title><h1>restored page</h1>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const WEB = `http://127.0.0.1:${server.address().port}/restored`;
const env = { LANG: 'en_US.UTF-8', LANGUAGE: 'en_US', LC_ALL: 'en_US.UTF-8' };

async function run(opts, fn) {
  const b = await launchBrowser({ binary, profileDir: profile, extensions: [extDir], env, ...opts });
  try {
    const { cdp } = b;
    const pages = async () => {
      const out = [];
      for (const t of (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page')) {
        const s = await cdp.attach(t.targetId).catch(() => null);
        out.push(s ? await Promise.race([cdp.evaluate(s, 'location.href'), sleep(3000).then(() => t.url)]).catch(() => t.url) : t.url);
      }
      return out;
    };
    const sw = async () => {
      const t = await cdp.waitForTarget((t) => t.type === 'service_worker' && t.url.includes('/background.js'), 10000);
      const s = await cdp.attach(t.targetId);
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
      await cdp.waitFor(s, `typeof chrome !== 'undefined' && !!chrome.storage`);
      return s;
    };
    await fn({ cdp, pages, sw });
  } finally {
    await closeBrowser(b);
  }
}
const EXT = 'chrome-extension://nngdpmabmapeoinhapfmhboloceopgic/';
const fixtureTitles = ['Video', 'Çalışma Alanı', 'Gizli Klasör', 'untitled.example', 'Long Title For A Banner Tool'];

try {
  // ---- 1. old build, used --------------------------------------------------
  cpSync(oldExt, extDir, { recursive: true });
  await run({}, async ({ cdp, sw }) => {
    const s = await sw();
    const cc = await cdp.openPage(EXT + 'index.html#dashboard');
    await cdp.waitFor(s, `chrome.storage.local.get('oxygen.config.v1').then(r => !!r['oxygen.config.v1'])`, 10000);
    await cdp.evaluate(s, `chrome.storage.local.get('oxygen.config.v1').then(async (r) => {
      const b = r['oxygen.config.v1'];
      b.modules.wallpapers = { ...(b.modules.wallpapers ?? {}), dim: 37 };
      await chrome.storage.local.set({
        'oxygen.config.v1': b,
        'oxygen.links': [{ id: 'u1', title: 'Mine', url: 'https://mine.example/' }],
        'oxygen.notes': 'my notes',
        'oxygen.newtab.layout': [{ id: 'w-links', type: 'links', x: 0, y: 0, w: 8, h: 2, settings: {} }, { id: 'w-clock', type: 'clock', x: 8, y: 0, w: 4, h: 2, settings: {} }],
      });
      return true;
    })`);
    await sleep(500);
    const v = await cdp.evaluate(s, `chrome.runtime.getManifest().version`);
    check('old build installed and used', v === '0.2.0', v);
  });

  // ---- 2. in-place update to the current build + Helium import ---------------
  rmSync(extDir, { recursive: true, force: true });
  cpSync(join(repo, 'dist/extension'), extDir, { recursive: true });
  rmSync(join(extDir, 'imported-shortcuts.json'), { force: true });
  execFileSync('node', [join(repo, 'scripts/import_shortcuts.mjs'), '--preferences', join(repo, 'tests/fixtures/helium-Preferences.json'), '--out', join(work, 'import.json'), '--dist', extDir], { stdio: 'ignore' });
  const version = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8')).version;

  await run({ startUrl: 'chrome://newtab/' }, async ({ cdp, pages, sw }) => {
    const s = await sw();
    await step('stale worker (root cause A)', async () => {
      const code = await cdp.evaluate(s, `typeof self.oxygenTest?.ingestShortcuts`);
      check('Chromium keeps the old service worker after the files changed (bug A reproduced)', code === 'undefined', `ingestShortcuts in worker: ${code}`);
      const st = await cdp.evaluate(s, `chrome.storage.local.get(['oxygen.links','oxygen.import.shortcuts']).then(r => JSON.stringify([(r['oxygen.links']||[]).map(l => l.title), r['oxygen.import.shortcuts'] ?? null]))`);
      check('…so the worker never imported the shortcuts', st === JSON.stringify([['Mine'], null]), st);
      const first = await pages();
      check('…and the startup tab is Helium’s own NTP (bug B reproduced)', first.some((u) => u.startsWith('chrome://new-tab-page')), first);
    });
    await step('fresh pages fix it in the same session', async () => {
      const nt = await cdp.openPage(EXT + 'newtab.html');
      const tiles = await cdp.waitFor(nt.sessionId, `(() => { const t = [...document.querySelectorAll('[data-testid=widget-links] .tile .name')].map(e => e.textContent).filter(x => x !== 'Add'); return t.length >= 6 && t; })()`, 10000);
      check('new tab shows the Helium shortcuts first, then the user’s link', JSON.stringify(tiles.slice(0, 6)) === JSON.stringify([...fixtureTitles, 'Mine']), tiles);
      const kept = await cdp.evaluate(s, `chrome.storage.local.get(['oxygen.config.v1','oxygen.notes','oxygen.newtab.layout']).then(r => JSON.stringify([r['oxygen.config.v1'].modules.wallpapers.dim, r['oxygen.notes'], r['oxygen.newtab.layout'].map(w => w.type)]))`);
      check('existing settings, notes and layout are kept', kept === JSON.stringify([37, 'my notes', ['links', 'clock', 'bookmarks']]), kept);
      const healed = await cdp.waitFor(s, `chrome.storage.local.get('oxygen.sw.healed').then(r => r['oxygen.sw.healed'])`, 8000).catch(() => null);
      check('page unregistered the stale worker once for this version', healed === version, `${healed} vs ${version}`);
      await cdp.send('Page.reload', {}, nt.sessionId);
      await sleep(1500);
      const again = await cdp.evaluate(s, `chrome.storage.local.get('oxygen.links').then(r => r['oxygen.links'].length)`).catch(() => 'worker gone');
      check('import is applied once (no duplicates on reload)', again === 6 || again === 'worker gone', String(again));
    });
  });

  // ---- 3. restart: fresh worker, startup tab becomes Oxygen ------------------
  await run({ startUrl: 'chrome://newtab/' }, async ({ cdp, pages, sw }) => {
    const s = await sw();
    await step('fresh worker + startup tab', async () => {
      const code = await cdp.evaluate(s, `typeof self.oxygenTest?.swapStartupNtps`);
      check('after one restart the current service worker runs', code === 'function', code);
      let first = [];
      for (let i = 0; i < 20; i++) {
        first = await pages();
        if (first.length && first.every((u) => u.startsWith(EXT))) break;
        await sleep(300);
      }
      check('startup tab ends up as Oxygen’s new tab (bug B fixed)', first.length > 0 && first.every((u) => u.startsWith(EXT + 'newtab.html')), first);
      const tab = await cdp.evaluate(s, `chrome.tabs.query({}).then(ts => ts[0].url)`);
      check('omnibox URL stays chrome://newtab/', tab === 'chrome://newtab/', tab);
      const links = await cdp.evaluate(s, `chrome.storage.local.get('oxygen.links').then(r => r['oxygen.links'].map(l => l.title))`);
      check('shortcuts still there after restart', JSON.stringify(links) === JSON.stringify([...fixtureTitles, 'Mine']), links);
      const ntT = await cdp.waitForTarget((t) => t.type === 'page' && t.url.startsWith('chrome://newtab'), 3000);
      const sh = await cdp.attach(ntT.targetId);
      await sleep(800);
      writeFileSync(join(shots, '23-startup-tab-oxygen.png'), await cdp.screenshot(sh));
      // leave a web page open for the session-restore check
      const web = await cdp.openPage(WEB);
      await cdp.waitFor(web.sessionId, `document.readyState === 'complete' && location.href.startsWith('http')`, 8000);
      await sleep(3500); // let the session service write the tab
    });
  });

  // ---- 4. restore last session -----------------------------------------------
  await run({ startUrl: null, extraArgs: ['--restore-last-session'] }, async ({ cdp, pages, sw }) => {
    const s = await sw();
    await step('restore last session', async () => {
      await sleep(3000);
      const urls = await pages();
      check('restored web tab is left alone', urls.includes(WEB), urls);
      check('no tab was swapped away from a real page', !urls.some((u) => u.startsWith('chrome://new-tab-page')), urls);
    });
  });
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(join(shots, 'results-upgrade.json'), JSON.stringify(results, null, 2));
console.log(`\n${passed}/${results.length} upgrade checks passed`);
process.exit(passed === results.length ? 0 : 1);
