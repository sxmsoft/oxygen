#!/usr/bin/env node
// Headless end-to-end check of the Oxygen feature modules on Helium:
// tab suspender, workspaces, command palette, side panel, new tab widgets,
// wallpapers, per-site rules, i18n. Throwaway profile + local fixture server;
// never touches the user's Helium profile or windows.
//
// Usage: node tests/e2e/verify_features.mjs [--binary PATH] [--shots DIR]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, closeBrowser, sleep, stageExtension } from './cdp.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const binary = opt('--binary', process.env.HELIUM_BIN ?? '/opt/helium-browser-bin/helium');
const shots = resolve(opt('--shots', join(repo, 'dist/e2e')));
mkdirSync(shots, { recursive: true });
const extDir = stageExtension(join(repo, 'dist/extension'));
const profile = mkdtempSync(join(tmpdir(), 'oxygen-e2e-features-'));
const media = mkdtempSync(join(tmpdir(), 'oxygen-e2e-media-'));

/** search, links, clock, bookmarks bar, weather, workspaces, recent */
const DEFAULT_WIDGETS = 7;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name}: unexpected error`, false, e.stack ?? String(e));
  }
}

// ---- fixtures ---------------------------------------------------------------
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.6 system-ui;margin:0;padding:40px 60px;background:#fff;color:#222}h1{color:#0b5}
.card{border:1px solid #ddd;border-radius:10px;padding:16px;margin:16px 0;background:#f6f7f9}</style></head>
<body><h1>${title}</h1>${body}<div class="card">Oxygen e2e fixture page.</div></body></html>`;
const server = createServer((req, res) => {
  const name = (req.url ?? '/').split('?')[0].replace(/^\//, '') || 'home';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(`Fixture ${name}`, `<p>Path <code>/${name}</code>. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const A = (p) => `http://127.0.0.1:${PORT}/${p}`; // host "127.0.0.1"
const L = (p) => `http://localhost:${PORT}/${p}`; // host "localhost"

// Wallpaper media generated locally (ffmpeg), so no binary files live in the repo.
const imgPath = join(media, 'wallpaper.png');
const vidPath = join(media, 'wallpaper.webm');
try {
  try {
    execFileSync('nice', ['-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=s=1600x1000:c0=0x0f1b3d:c1=0x3b1f5c:c2=0x0b4a4a:c3=0x1a1030:nb_colors=4:type=radial:seed=7', '-frames:v', '1', imgPath]);
  } catch {
    execFileSync('nice', ['-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=size=1280x800', '-frames:v', '1', imgPath]);
  }
  execFileSync('nice', ['-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=15', '-t', '3', '-c:v', 'libvpx', '-b:v', '200k', '-an', vidPath]);
} catch (e) {
  console.log('ffmpeg unavailable: media upload checks will fail', e.message);
}

let browser;
try {
  browser = await launchBrowser({ binary, profileDir: profile, extensions: [extDir, join(repo, 'dist/themes/obsidian')], extraArgs: ['--lang=en-US'],
    // UI locale on Linux comes from the environment; pin English so 'auto' is deterministic.
    env: { LANG: 'en_US.UTF-8', LANGUAGE: 'en_US', LC_ALL: 'en_US.UTF-8' } });
  const { cdp } = browser;
  const swT = await cdp.waitForTarget((t) => t.type === 'service_worker' && t.url.endsWith('/background.js') && t.url.startsWith('chrome-extension://'));
  const sw = await cdp.attach(swT.targetId);
  await cdp.send('Runtime.runIfWaitingForDebugger', {}, sw).catch(() => {});
  await cdp.waitFor(sw, `typeof chrome !== 'undefined' && !!self.oxygenTest`);
  const ext = new URL(swT.url).host;
  const EXT = (p) => `chrome-extension://${ext}/${p}`;
  const ev = (expr) => cdp.evaluate(sw, expr);
  /** Opens a web page and waits until the real URL (not the initial about:blank) has loaded. */
  const openWeb = async (url) => {
    const p = await cdp.openPage(url);
    const ready = `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`;
    try {
      await cdp.waitFor(p.sessionId, ready, 6000);
    } catch {
      await cdp.send('Page.navigate', { url }, p.sessionId); // initial navigation got lost
      await cdp.waitFor(p.sessionId, ready, 15000);
    }
    return p;
  };
  const shot = async (session, name) => writeFileSync(join(shots, name), await cdp.screenshot(session));
  // Config edits from the test go straight to chrome.storage (like another Oxygen tab would);
  // each edit is read back and retried, so a page that is still initializing can't race it.
  const editConfig = async (fnSrc, verifySrc) => {
    for (let i = 0; i < 8; i++) {
      await ev(`chrome.storage.local.get('oxygen.config.v1').then(async (r) => {
        const b = r['oxygen.config.v1'];
        (${fnSrc})(b);
        await chrome.storage.local.set({ 'oxygen.config.v1': b });
        return true;
      })`);
      await sleep(250);
      if (await ev(`chrome.storage.local.get('oxygen.config.v1').then(r => (${verifySrc})(r['oxygen.config.v1']))`)) return;
    }
    throw new Error('config edit did not stick');
  };
  const setModule = (id, patch) =>
    editConfig(
      `(b) => { b.modules[${JSON.stringify(id)}] = { ...(b.modules[${JSON.stringify(id)}] ?? {}), ...${JSON.stringify(patch)} }; }`,
      `(b) => Object.entries(${JSON.stringify(patch)}).every(([k, v]) => JSON.stringify(b.modules[${JSON.stringify(id)}]?.[k]) === JSON.stringify(v))`
    );
  const toggleModule = (id, on) =>
    editConfig(
      `(b) => { const id = ${JSON.stringify(id)}; b.enabledModuleIds = b.enabledModuleIds.filter((x) => x !== id); b.disabledModuleIds = (b.disabledModuleIds ?? []).filter((x) => x !== id); (${on} ? b.enabledModuleIds : b.disabledModuleIds).push(id); }`,
      `(b) => ${on} ? b.enabledModuleIds.includes(${JSON.stringify(id)}) : (b.disabledModuleIds ?? []).includes(${JSON.stringify(id)})`
    );
  // Wait until the default config bundle exists (written by the first Oxygen page / SW start).
  const boot = await cdp.openPage(EXT('index.html#dashboard'));
  await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.config.v1').then(r => !!r['oxygen.config.v1'])`);

  // ---------------------------------------------------------------- manifest
  await step('manifest', async () => {
    const m = await ev(`chrome.runtime.getManifest()`);
    check('permissions requested', true, m.permissions.join(', ') + ' | hosts: ' + m.host_permissions.join(', '));
    const cmds = await ev(`self.oxygenTest.commands()`);
    const pal = cmds.find((c) => c.name === 'open-palette');
    check('palette command registered with default shortcut', pal?.shortcut === 'Alt+K', JSON.stringify(cmds.map((c) => [c.name, c.shortcut])));
    const opts = await ev(`chrome.sidePanel.getOptions({})`);
    check('side panel registered (sidepanel.html)', opts.path === 'sidepanel.html' && opts.enabled !== false, JSON.stringify(opts));
  });

  // ---------------------------------------------------------------- suspender
  await step('suspender', async () => {
    await setModule('tab-suspender', { idleMinutes: 1, whitelist: 'localhost' });
    const ids = await ev(`(async () => {
      const w = (await chrome.windows.getAll({ windowTypes: ['normal'] }))[0];
      const mk = (url) => chrome.tabs.create({ url, active: false, windowId: w.id }).then((t) => t.id);
      const ids = { a: await mk('${A('sa')}'), b: await mk('${A('sb')}'), pinned: await mk('${A('sp')}'), white: await mk('${L('sw')}'), active: await mk('${A('sact')}') };
      await chrome.tabs.update(ids.pinned, { pinned: true });
      await chrome.tabs.update(ids.active, { active: true });
      return ids;
    })()`);
    await cdp.waitFor(sw, `Promise.all(Object.values(${JSON.stringify(ids)}).map(id => chrome.tabs.get(id))).then(ts => ts.every(t => t.status === 'complete' && t.url))`, 15000);
    const sched = await ev(`self.oxygenTest.reconcileSuspender(Date.now())`);
    const alarms = await ev(`chrome.alarms.getAll().then(a => a.filter(x => x.name.startsWith('ox-suspend:')).length)`);
    check('idle tabs get one-shot alarms (no polling)', alarms >= 2 && sched.suspended === 0, JSON.stringify({ sched, alarms }));
    const res = await ev(`self.oxygenTest.reconcileSuspender(Date.now() + 2 * 60_000)`);
    // Discarding replaces a tab's id (tabs.onReplaced), so look tabs up by URL.
    const urls = { a: A('sa'), b: A('sb'), pinned: A('sp'), white: L('sw'), active: A('sact') };
    const st = await ev(`chrome.tabs.query({}).then(ts => Object.entries(${JSON.stringify(urls)}).map(([k, u]) => [k, !!ts.find(t => t.url === u)?.discarded]))`);
    const d = Object.fromEntries(st);
    const why = d.a && d.b ? '' : JSON.stringify(await ev(`self.oxygenTest.explainSuspend(Date.now() + 2 * 60_000)`));
    check('idle background tabs discarded', d.a && d.b, JSON.stringify({ res, d }) + why);
    check('pinned / whitelisted / active tabs kept', !d.pinned && !d.white && !d.active, JSON.stringify(d));
    const stats = await ev(`self.oxygenTest.suspenderStats()`);
    check('RAM indicator = discarded count × estimate', stats.discardedNow >= 2 && stats.estimatedMb === stats.discardedNow * stats.mbPerTab, JSON.stringify(stats));
    await toggleModule('tab-suspender', false);
    await sleep(500);
    const after = await ev(`chrome.alarms.getAll().then(a => a.filter(x => x.name.startsWith('ox-suspend:')).length)`);
    check('disabling the module clears its alarms', after === 0, `alarms=${after}`);
    await toggleModule('tab-suspender', true);
    await ev(`chrome.tabs.query({}).then(ts => chrome.tabs.remove(ts.filter(t => Object.values(${JSON.stringify(urls)}).includes(t.url)).map(t => t.id)))`);
  });

  // ---------------------------------------------------------------- workspaces
  let wsJson = '';
  await step('workspaces', async () => {
    const r = await ev(`(async () => {
      const w = await chrome.windows.create({ url: ['${A('w1')}', '${A('w2')}', '${A('w3')}'], focused: true });
      await new Promise(r => setTimeout(r, 800));
      const tabs = await chrome.tabs.query({ windowId: w.id });
      const gid = await chrome.tabs.group({ tabIds: [tabs[0].id, tabs[1].id], createProperties: { windowId: w.id } });
      await chrome.tabGroups.update(gid, { title: 'Research', color: 'purple', collapsed: false });
      await chrome.tabs.update(tabs[2].id, { pinned: true });
      const ws = await self.oxygenTest.saveWorkspace('E2E set', w.id);
      return { windowId: w.id, ws };
    })()`);
    const g = r.ws?.windows?.[0];
    check('save workspace captures tabs, pinned state and group title/color',
      g && g.tabs.length === 3 && g.groups.length === 1 && g.groups[0].title === 'Research' && g.groups[0].color === 'purple' && g.tabs.some((t) => t.pinned),
      JSON.stringify(g));
    await ev(`chrome.windows.remove(${r.windowId})`);
    const restored = await ev(`self.oxygenTest.restoreById(${JSON.stringify(r.ws.id)}).then(async ([id]) => {
      await new Promise(r => setTimeout(r, 800));
      const tabs = await chrome.tabs.query({ windowId: id });
      const groups = await chrome.tabGroups.query({ windowId: id });
      return { id, n: tabs.length, pinned: tabs.filter(t => t.pinned).length, groups: groups.map(g => [g.title, g.color]), grouped: tabs.filter(t => t.groupId >= 0).length };
    })`);
    check('restore recreates window, pinned tab and colored group', restored.n === 3 && restored.pinned === 1 && restored.grouped === 2 && restored.groups[0]?.[0] === 'Research' && restored.groups[0]?.[1] === 'purple', JSON.stringify(restored));
    // Autosave: debounced on tab events (no polling).
    await ev(`chrome.tabs.create({ url: '${A('auto')}', active: false, windowId: ${restored.id} })`);
    const auto = await cdp.waitFor(sw, `self.oxygenTest.getStore().then(s => s.lastSession && s.lastSession.windows.flatMap(w => w.tabs).some(t => t.url.includes('/auto')) && s.lastSession.windows.flatMap(w => w.tabs).length)`, 9000);
    check('last session autosaved after tab changes', auto > 0, `tabs=${auto}`);
    await ev(`chrome.windows.remove(${restored.id})`);

    // Export / import through the Control Center UI.
    const cc = await cdp.openPage(EXT('index.html#workspaces'));
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-testid=ws-item]') !== null`);
    wsJson = await ev(`self.oxygenTest.getStore().then(s => JSON.stringify({ format: 'oxygen-workspaces', version: 1, workspaces: s.saved }))`);
    await cdp.evaluate(cc.sessionId, `(() => { const t = document.querySelector('[data-testid=ws-import-text]'); t.value = ${JSON.stringify(wsJson)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(100);
    await cdp.evaluate(cc.sessionId, `document.querySelector('[data-testid=ws-import]').click() || true`);
    const n = await cdp.waitFor(cc.sessionId, `document.querySelectorAll('[data-testid=ws-item]').length === 2 && document.querySelector('[data-testid=ws-import-msg]').textContent`);
    check('JSON import via Control Center (ids de-duplicated)', !!n, n);
    await sleep(300);
    await shot(cc.sessionId, '15-cc-workspaces.png');
    await cdp.send('Target.closeTarget', { targetId: cc.targetId });
  });

  // ---------------------------------------------------------------- site rules
  await step('site rules', async () => {
    const cc = await cdp.openPage(EXT('index.html#sites'));
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-testid=sites-pattern]') !== null`);
    await cdp.evaluate(cc.sessionId, `(() => { const i = document.querySelector('[data-testid=sites-pattern]'); i.value = 'localhost/docs'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await cdp.evaluate(cc.sessionId, `document.querySelector('[data-testid=sites-add]').click() || true`);
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-testid=site-rule]') !== null`);
    await cdp.evaluate(cc.sessionId, `(() => {
      const r = document.querySelector('[data-testid=site-rule]');
      const boxes = r.querySelectorAll('input[type=checkbox]');
      boxes[1].click();
      const s = r.querySelector('select'); s.value = '1.25'; s.dispatchEvent(new Event('change', { bubbles: true }));
      const ta = r.querySelector('textarea'); ta.value = 'h1 { outline: 3px solid rgb(255, 0, 0) }'; ta.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const rules = await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.sites.rules').then(r => { const x = r['oxygen.sites.rules'] ?? []; return x[0]?.forceDark && x[0]?.zoom === 1.25 && x[0]?.css ? x : false; })`);
    check('rule created from Control Center (pattern, dark, zoom, CSS)', rules.length === 1, JSON.stringify(rules));
    await shot(cc.sessionId, '16-cc-site-rules.png');

    const p = await openWeb(L('docs/page'));
    const dark = await cdp.waitFor(p.sessionId, `getComputedStyle(document.documentElement).filter.includes('invert') && getComputedStyle(document.documentElement).filter`);
    check('forced dark CSS injected on matching page', !!dark, dark);
    const outline = await cdp.evaluate(p.sessionId, `getComputedStyle(document.querySelector('h1')).outlineColor`);
    check('custom CSS injected', outline === 'rgb(255, 0, 0)', outline);
    const zoom = await cdp.waitFor(sw, `chrome.tabs.query({ url: '${L('docs/page')}' }).then(([t]) => chrome.tabs.getZoom(t.id)).then(z => Math.abs(z - 1.25) < 0.01 && z)`);
    check('per-site zoom applied on navigation', zoom === 1.25, String(zoom));
    await shot(p.sessionId, '17-site-dark.png');
    const other = await openWeb(L('blog'));
    await sleep(400);
    const otherFilter = await cdp.evaluate(other.sessionId, `getComputedStyle(document.documentElement).filter`);
    const otherZoom = await ev(`chrome.tabs.query({ url: '${L('blog')}' }).then(([t]) => chrome.tabs.getZoom(t.id))`);
    check('non-matching path untouched', otherFilter === 'none' && otherZoom === 1, `${otherFilter} ${otherZoom}`);
    // Quick toggle (palette / side panel command) on another host.
    const q = await openWeb(A('quick'));
    const qid = await ev(`chrome.tabs.query({ url: '${A('quick')}' }).then(([t]) => t.id)`);
    const r1 = await ev(`chrome.tabs.get(${qid}).then(t => self.oxygenTest.runCommand('toggle-dark', t))`);
    const on = await cdp.waitFor(q.sessionId, `getComputedStyle(document.documentElement).filter.includes('invert')`);
    await ev(`chrome.tabs.get(${qid}).then(t => self.oxygenTest.runCommand('toggle-dark', t))`);
    const off = await cdp.waitFor(q.sessionId, `getComputedStyle(document.documentElement).filter === 'none'`);
    check('quick dark-mode toggle applies and removes live', on && off, JSON.stringify(r1));
    await toggleModule('site-rules', false);
    const gone = await cdp.waitFor(p.sessionId, `getComputedStyle(document.documentElement).filter === 'none'`);
    check('disabling Site Rules removes injected CSS', gone);
    await toggleModule('site-rules', true);
    for (const s of [cc, p, other, q]) await cdp.send('Target.closeTarget', { targetId: s.targetId });
  });

  // ---------------------------------------------------------------- palette
  await step('palette', async () => {
    await ev(`chrome.bookmarks.create({ title: 'Oxygen bookmark fixture', url: '${A('bookmarked')}' }).then(() => true)`);
    // A visited-then-closed page, so history has an entry that is not an open tab.
    const h = await cdp.openPage('about:blank');
    await cdp.send('Page.navigate', { url: A('visited-history') }, h.sessionId);
    await cdp.waitFor(sw, `chrome.history.search({ text: 'visited-history', startTime: 0 }).then(r => r.length > 0)`, 10000);
    await cdp.send('Target.closeTarget', { targetId: h.targetId });
    const p = await openWeb(A('palette-host'));
    const tid = await ev(`chrome.tabs.query({ url: '${A('palette-host')}' }).then(([t]) => t.id)`);
    const how = await ev(`self.oxygenTest.openPaletteFor(${tid})`);
    check('shortcut on a web page injects the palette (content script)', how === 'content', how + ' ' + (await ev('self.oxygenTest.lastPaletteError()')));
    await cdp.waitFor(p.sessionId, `document.getElementById('oxygen-palette-host')?.shadowRoot?.querySelectorAll('li[data-kind]').length > 0`);
    const kinds0 = await cdp.evaluate(p.sessionId, `[...new Set([...document.getElementById('oxygen-palette-host').shadowRoot.querySelectorAll('li[data-kind]')].map(li => li.dataset.kind))]`);
    check('empty query lists commands and open tabs', kinds0.includes('command') && kinds0.includes('tab'), kinds0.join());
    const typeQ = (q) => cdp.evaluate(p.sessionId, `(() => { const i = document.getElementById('oxygen-palette-host').shadowRoot.querySelector('input'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return true; })()`);
    await typeQ('fixture');
    await sleep(500);
    const kinds = await cdp.evaluate(p.sessionId, `[...document.getElementById('oxygen-palette-host').shadowRoot.querySelectorAll('li[data-kind]')].map(li => li.dataset.kind)`);
    check('search covers tabs, history and bookmarks', kinds.includes('tab') && kinds.includes('history') && kinds.includes('bookmark'), kinds.join());
    await typeQ('save win');
    await sleep(400);
    await shot(p.sessionId, '13-palette-webpage.png');
    const first = await cdp.evaluate(p.sessionId, `document.getElementById('oxygen-palette-host').shadowRoot.querySelector('li[data-kind]')?.textContent.replace(/\\s+/g, ' ').trim()`);
    check('commands are searchable', /save/i.test(first ?? ''), first);
    const before = await ev(`self.oxygenTest.getStore().then(s => s.saved.length)`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, p.sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, p.sessionId);
    const afterN = await cdp.waitFor(sw, `self.oxygenTest.getStore().then(s => s.saved.length > ${before} && s.saved.length)`);
    check('Enter runs the selected command (save workspace)', afterN > before, `${before} -> ${afterN}`);
    // Oxygen pages: Ctrl+K in-page.
    const nt = await cdp.openPage('chrome://newtab/');
    await cdp.waitFor(nt.sessionId, `document.querySelector('[data-testid=widget-grid]') !== null`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 }, nt.sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 }, nt.sessionId);
    const ok = await cdp.waitFor(nt.sessionId, `document.getElementById('oxygen-palette-host')?.shadowRoot?.querySelectorAll('li[data-kind]').length > 0`);
    check('Ctrl+K opens the palette on the Oxygen new tab', ok);
    await sleep(300);
    await shot(nt.sessionId, '14-palette-newtab.png');
    // chrome:// page -> popup window fallback
    const v = await cdp.openPage('chrome://version/');
    await sleep(300);
    const vid = await ev(`chrome.tabs.query({ url: 'chrome://version/' }).then(([t]) => t.id)`);
    const how2 = await ev(`self.oxygenTest.openPaletteFor(${vid})`);
    const popup = await cdp.waitForTarget((t) => t.url.startsWith(EXT('palette.html')), 5000).catch(() => null);
    check('chrome:// pages fall back to a palette popup window', how2 === 'popup' && !!popup, how2);
    if (popup) await cdp.send('Target.closeTarget', { targetId: popup.targetId });
    for (const s of [p, nt, v]) await cdp.send('Target.closeTarget', { targetId: s.targetId });
  });

  // ---------------------------------------------------------------- side panel
  await step('side panel', async () => {
    const win = await ev(`(async () => {
      const w = await chrome.windows.create({ url: ['${A('one')}', '${A('two')}', '${A('three')}', '${A('four')}'], focused: true });
      await new Promise(r => setTimeout(r, 800));
      const tabs = await chrome.tabs.query({ windowId: w.id });
      const g = await chrome.tabs.group({ tabIds: [tabs[1].id, tabs[2].id], createProperties: { windowId: w.id } });
      await chrome.tabGroups.update(g, { title: 'Docs', color: 'blue' });
      return { id: w.id, tabs: tabs.map(t => t.id) };
    })()`);
    // The panel itself needs a user gesture to open; its page is rendered in a tab of the same window.
    const sp = await ev(`chrome.tabs.create({ url: '${EXT('sidepanel.html')}', windowId: ${win.id}, active: true }).then(t => t.id)`);
    const spT = await cdp.waitForTarget((t) => t.url.startsWith(EXT('sidepanel.html')));
    const s = await cdp.attach(spT.targetId);
    await cdp.send('Page.enable', {}, s);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 760, deviceScaleFactor: 1, mobile: false }, s);
    const rows = await cdp.waitFor(s, `document.querySelectorAll('[data-tab-id]').length >= 5 && document.querySelectorAll('[data-tab-id]').length`);
    const grp = await cdp.evaluate(s, `[...document.querySelectorAll('[data-testid=sp-group]')].map(g => g.textContent.replace(/\\s+/g, ' ').trim())`);
    check('vertical tabs list the window with its group', rows === 5 && grp.length === 1 && grp[0].includes('Docs'), JSON.stringify({ rows, grp }));
    // Drag the last web tab before the first one (HTML5 drag events).
    await cdp.evaluate(s, `(() => {
      const src = document.querySelector('[data-tab-id="${win.tabs[3]}"]');
      const dst = document.querySelector('[data-tab-id="${win.tabs[0]}"]');
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    const order = await cdp.waitFor(sw, `chrome.tabs.query({ windowId: ${win.id} }).then(t => t[0].id === ${win.tabs[3]} && t.map(x => x.id))`);
    check('drag reorder moves the tab (chrome.tabs.move)', !!order, JSON.stringify(order));
    await cdp.evaluate(s, `(() => { const f = document.querySelector('[data-testid=sp-filter]'); f.value = 'three'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const filtered = await cdp.waitFor(s, `document.querySelectorAll('[data-tab-id]').length === 1 && document.querySelector('[data-tab-id]').textContent.trim()`);
    check('tab search filters the list', /three/i.test(filtered), filtered);
    await cdp.evaluate(s, `(() => { const f = document.querySelector('[data-testid=sp-filter]'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await cdp.evaluate(s, `document.querySelector('[data-tab-id="${win.tabs[0]}"] .close').click() || true`);
    const closed = await cdp.waitFor(sw, `chrome.tabs.query({ windowId: ${win.id} }).then(t => !t.some(x => x.id === ${win.tabs[0]}))`);
    check('close button closes the tab', closed);
    await sleep(300);
    await shot(s, '12-sidepanel-tabs.png');
    // Notes + links
    await cdp.evaluate(s, `document.querySelector('[data-testid=sp-tab-notes]').click() || true`);
    await cdp.waitFor(s, `document.querySelector('[data-testid=sp-notes]') !== null`);
    await cdp.evaluate(s, `(() => { const t = document.querySelector('[data-testid=sp-notes]'); t.value = '# Plan\\n- [x] **ship** Oxygen\\n- [ ] write *notes*\\n<script>alert(1)</' + 'script>'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const saved = await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.notes').then(r => (r['oxygen.notes'] ?? '').includes('Plan'))`);
    await cdp.evaluate(s, `[...document.querySelectorAll('.notes button')].find(b => /preview/i.test(b.textContent)).click() || true`);
    const html = await cdp.waitFor(s, `document.querySelector('[data-testid=sp-notes-preview]')?.innerHTML`);
    check('notes saved locally and rendered as safe markdown', saved && html.includes('<h1>Plan</h1>') && html.includes('<strong>ship</strong>') && !html.includes('<script'), html.slice(0, 120));
    await shot(s, '12b-sidepanel-notes.png');
    await cdp.evaluate(s, `document.querySelector('[data-testid=sp-tab-links]').click() || true`);
    await cdp.waitFor(s, `document.querySelector('[data-testid=sp-link-url]') !== null`);
    await cdp.evaluate(s, `(() => { const i = document.querySelector('[data-testid=sp-link-url]'); i.value = 'github.com'; i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); return true; })()`);
    const links = await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.links').then(r => (r['oxygen.links'] ?? []).length && r['oxygen.links'])`);
    check('quick links added (shared with the new tab)', links[0]?.url === 'https://github.com/', JSON.stringify(links));
    await toggleModule('side-panel', false);
    const disabled = await cdp.waitFor(sw, `chrome.sidePanel.getOptions({}).then(o => o.enabled === false)`);
    check('disabling Side Panel disables chrome.sidePanel', disabled);
    await toggleModule('side-panel', true);
    await ev(`chrome.windows.remove(${win.id})`);
  });

  // ---------------------------------------------------------------- new tab + wallpapers
  await step('new tab', async () => {
    await ev(`chrome.storage.local.set({ 'oxygen.links': [
      { id: 'l1', title: 'GitHub', url: 'https://github.com/' },
      { id: 'l2', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
      { id: 'l3', title: 'Open-Meteo', url: 'https://open-meteo.com/' },
      { id: 'l4', title: 'Fixture', url: '${A('fav')}' },
      { id: 'l5', title: 'Helium', url: 'https://helium.computer/' }
    ] }).then(() => true)`);
    const nt = await cdp.openPage('chrome://newtab/');
    const S = nt.sessionId;
    const n = await cdp.waitFor(S, `document.querySelectorAll('[data-widget-id]').length >= ${DEFAULT_WIDGETS} && document.querySelectorAll('[data-widget-id]').length`);
    check('default widgets rendered (lazy-loaded)', n === DEFAULT_WIDGETS, `widgets=${n}`);
    // Weather uses the widget's city setting; set one explicitly (default locale here is en).
    const layout0 = await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.newtab.layout').then(r => r['oxygen.newtab.layout'] ?? 'none')`);
    await cdp.evaluate(S, `document.querySelector('[data-testid=customize]').click() || true`);
    await cdp.waitFor(S, `document.querySelector('[data-testid=customize-drawer]') !== null`);
    await cdp.evaluate(S, `document.querySelector('[data-widget-type=weather] button[aria-label="Settings"]').click() || true`);
    await cdp.waitFor(S, `document.querySelector('[data-testid=widget-settings] input.ox-input') !== null`);
    await cdp.evaluate(S, `(() => { const i = document.querySelector('[data-testid=widget-settings] input.ox-input'); i.value = 'Istanbul'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const wstate = await cdp.waitFor(S, `['ok','error'].includes(document.querySelector('[data-testid=widget-weather]')?.dataset.state) && document.querySelector('[data-testid=widget-weather]').dataset.state + ': ' + document.querySelector('[data-testid=widget-weather]').textContent.replace(/\\s+/g,' ').trim()`, 15000);
    check('weather widget (Open-Meteo geocoding + forecast, no key)', wstate.startsWith('ok'), wstate);
    // Add + remove widgets
    await cdp.evaluate(S, `document.querySelector('[data-testid=add-notes]').click() || true`);
    const n2 = await cdp.waitFor(S, `document.querySelectorAll('[data-widget-id]').length === ${DEFAULT_WIDGETS + 1} && ${DEFAULT_WIDGETS + 1}`);
    check('widget added from the customize drawer', n2 === DEFAULT_WIDGETS + 1);
    await cdp.evaluate(S, `document.querySelector('[data-widget-type=notes] [data-testid=remove-widget]').click() || true`);
    await cdp.waitFor(S, `document.querySelectorAll('[data-widget-id]').length === ${DEFAULT_WIDGETS}`);
    check('widget removed', true);
    // Drag the clock to the right half of row 1 with real mouse input.
    const rect = (sel) => cdp.evaluate(S, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const grid = await rect('[data-testid=widget-grid]');
    const handle = await rect('[data-widget-type=clock] .chrome');
    const mouse = async (type, x, y, buttons = 1) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 }, S);
    const sx = handle.x + 30, sy = handle.y + handle.h / 2;
    await mouse('mouseMoved', sx, sy, 0);
    await mouse('mousePressed', sx, sy);
    const colW = (grid.w - 14 * 11) / 12;
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', sx + (8 * (colW + 14) * i) / 8, sy, 1);
    await mouse('mouseReleased', sx + 8 * (colW + 14), sy, 0);
    const moved = await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.newtab.layout').then(r => { const c = (r['oxygen.newtab.layout'] ?? []).find(w => w.type === 'clock'); return c && c.x === 8 && c; })`);
    check('drag moves the widget on the 12-column grid (others pushed/compacted)', moved?.x === 8, JSON.stringify(moved));
    // Resize the links widget (after the move animation settled)
    await sleep(500);
    const rz = await rect('[data-widget-type=links] [data-testid=resize-handle]');
    const rx = rz.x + 8, ry = rz.y + 8;
    await mouse('mouseMoved', rx, ry, 0);
    await mouse('mousePressed', rx, ry);
    for (let i = 1; i <= 5; i++) await mouse('mouseMoved', rx, ry + (100 * i) / 5, 1);
    await mouse('mouseReleased', rx, ry + 100, 0);
    const resized = await cdp.waitFor(sw, `chrome.storage.local.get('oxygen.newtab.layout').then(r => { const c = (r['oxygen.newtab.layout'] ?? []).find(w => w.type === 'links'); return c && c.h > 2 && c; })`);
    check('resize handle changes widget height', resized?.h > 2, JSON.stringify(resized));
    // Persistence: reload keeps the layout.
    const stored = await ev(`chrome.storage.local.get('oxygen.newtab.layout').then(r => JSON.stringify(r['oxygen.newtab.layout'].map(w => [w.id, w.x, w.y, w.w, w.h])))`);
    await cdp.send('Page.reload', {}, S);
    await cdp.waitFor(S, `document.querySelectorAll('[data-widget-id]').length === ${DEFAULT_WIDGETS}`);
    await sleep(300);
    const domLayout = await cdp.evaluate(S, `[...document.querySelectorAll('[data-widget-id]')].map(e => e.dataset.widgetId).sort().join()`);
    const stored2 = await ev(`chrome.storage.local.get('oxygen.newtab.layout').then(r => JSON.stringify(r['oxygen.newtab.layout'].map(w => [w.id, w.x, w.y, w.w, w.h])))`);
    check('layout persists across reloads', stored === stored2 && domLayout.split(',').length === DEFAULT_WIDGETS, stored2);

    // ---- wallpapers
    const wp = () => cdp.evaluate(S, `(() => { const w = document.querySelector('[data-testid=wallpaper]'); return w && { kind: w.dataset.kind, playing: w.dataset.playing, reduced: w.dataset.reduced, bg: w.querySelector('.media').style.background.slice(0, 40), video: !!w.querySelector('video'), paused: w.querySelector('video')?.paused ?? null }; })()`);
    const w0 = await wp();
    check('default wallpaper is a static gradient', w0.kind === 'gradient' && w0.playing === 'false', JSON.stringify(w0));
    await setModule('wallpapers', { kind: 'aurora' });
    const lite = await cdp.waitFor(S, `(() => { const w = document.querySelector('[data-testid=wallpaper]'); return w?.dataset.kind === 'aurora' && document.documentElement.dataset.perf + '/' + w.dataset.playing; })()`);
    check('performance mode (auto, <= 8 GB) keeps aurora static', lite === 'lite/false', lite);
    await ev(`chrome.storage.local.set({ 'oxygen.perf': { mode: 'off', glass: false } })`);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, S);
    const pl = await cdp.waitFor(S, `document.querySelector('[data-testid=wallpaper]')?.dataset.playing === 'true'`);
    check('aurora animates with performance mode off (visible + focused)', pl);
    await shot(S, '10-newtab-widgets-aurora.png');
    await setModule('wallpapers', { kind: 'gradient', color1: '#1b2a4a', color2: '#5b2a6e', angle: 135 });
    const wg = await cdp.waitFor(S, `document.querySelector('[data-testid=wallpaper]')?.dataset.kind === 'gradient' && document.querySelector('[data-testid=wallpaper] .media').style.background`);
    check('gradient wallpaper', /linear-gradient/.test(wg), wg);
    // Image upload -> IndexedDB
    const setFile = async (sel, path) => {
      await cdp.evaluate(S, `document.querySelector('[data-testid=customize-drawer]') || document.querySelector('[data-testid=customize]').click() || true`);
      await cdp.waitFor(S, `document.querySelector(${JSON.stringify(sel)}) !== null`);
      const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})` }, S);
      await cdp.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId }, S);
    };
    await cdp.send('DOM.enable', {}, S);
    if (existsSync(imgPath)) {
      await setFile('[data-testid=wp-upload-image]', imgPath);
      const wi = await cdp.waitFor(S, `document.querySelector('[data-testid=wallpaper]')?.dataset.kind === 'image' && document.querySelector('[data-testid=wallpaper] .media').style.background.includes('blob:')`);
      const bytes = await ev(`chrome.storage.local.getBytesInUse(null)`);
      check('image wallpaper stored in IndexedDB (not chrome.storage)', wi && bytes < 200_000, `storage.local bytes=${bytes}`);
      await setModule('wallpapers', { blur: 6, dim: 35 });
      await cdp.waitFor(S, `document.querySelector('[data-testid=wallpaper] .media').style.filter.includes('blur(6px)')`);
      check('blur / dim controls applied', true);
      await cdp.evaluate(S, `document.querySelector('.drawer [aria-label=Close]')?.click() || true`);
      await sleep(400);
      await shot(S, '11-newtab-image-wallpaper.png');
      await setModule('wallpapers', { blur: 0, dim: 20 });
    } else check('image wallpaper', false, 'no test image');
    if (existsSync(vidPath)) {
      await setFile('[data-testid=wp-upload-video]', vidPath);
      const wv = await cdp.waitFor(S, `(() => { const v = document.querySelector('[data-testid=wallpaper] video'); return v && !v.paused && v.loop && v.muted; })()`, 10000);
      check('live video wallpaper plays muted + looping', wv);
      // Hidden tab -> paused
      const other = await cdp.openPage(A('cover'));
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }, S); // emulated focus also pins visibility
      await cdp.send('Target.activateTarget', { targetId: other.targetId });
      await sleep(600);
      const hid = await cdp.evaluate(S, `({ hidden: document.hidden, paused: document.querySelector('[data-testid=wallpaper] video').paused })`);
      check('video pauses while the new tab is hidden', hid.hidden && hid.paused, JSON.stringify(hid));
      await cdp.send('Target.closeTarget', { targetId: other.targetId });
      await cdp.send('Target.activateTarget', { targetId: nt.targetId });
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, S);
      await sleep(600);
      const back = await cdp.evaluate(S, `({ hidden: document.hidden, paused: document.querySelector('[data-testid=wallpaper] video').paused })`);
      check('video resumes when visible again', !back.hidden && !back.paused, JSON.stringify(back));
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, S);
      const red = await cdp.waitFor(S, `(() => { const w = document.querySelector('[data-testid=wallpaper]'); return w.dataset.reduced === 'true' && w.querySelector('video').paused && w.dataset.playing; })()`);
      check('prefers-reduced-motion pauses the live wallpaper', red === 'false', red);
      await setModule('wallpapers', { kind: 'aurora' });
      const ar = await cdp.waitFor(S, `(() => { const w = document.querySelector('[data-testid=wallpaper]'); return w.dataset.kind === 'aurora' && w.querySelector('canvas') && w.dataset.playing; })()`);
      check('reduced motion pauses the aurora too', ar === 'false', ar);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, S);
    } else check('video wallpaper', false, 'no test video');
    await setModule('wallpapers', { kind: 'particles' });
    await cdp.waitFor(S, `document.querySelector('[data-testid=wallpaper]')?.dataset.kind === 'particles' && document.querySelector('[data-testid=wallpaper]').dataset.playing === 'true'`);
    check('particles canvas wallpaper', true);
    await sleep(500);
    await shot(S, '10b-newtab-particles.png');
    await setModule('wallpapers', { kind: 'aurora' });
    // Widgets module off -> minimal page
    await toggleModule('newtab-widgets', false);
    const min = await cdp.waitFor(S, `document.querySelector('[data-testid=widget-grid]') === null && document.querySelector('.minimal') !== null`);
    check('disabling New Tab Widgets leaves a minimal page', min);
    await toggleModule('newtab-widgets', true);
    await cdp.send('Page.reload', {}, S); // leave edit mode for the final shot
    await cdp.waitFor(S, `document.querySelectorAll('[data-widget-id]').length === ${DEFAULT_WIDGETS} && document.querySelector('[data-testid=widget-weather]')?.dataset.state === 'ok'`, 12000);
    await sleep(1200);
    await shot(S, '10-newtab-widgets-aurora.png');
  });

  // ---------------------------------------------------------------- i18n + Control Center shots
  await step('i18n', async () => {
    const cc = await cdp.openPage(EXT('index.html#advanced'));
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-testid=language]') !== null`);
    const en = await cdp.evaluate(cc.sessionId, `document.querySelector('[data-section=dashboard]').textContent.trim()`);
    await cdp.evaluate(cc.sessionId, `(() => { const s = document.querySelector('[data-testid=language]'); s.value = 'tr'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const tr = await cdp.waitFor(cc.sessionId, `document.querySelector('[data-section=dashboard]').textContent.trim() === 'Panel' && document.querySelector('[data-section=workspaces]').textContent.trim()`);
    check('language switch to Turkish', en === 'Dashboard' && tr === 'Çalışma Alanları', `${en} -> ${tr}`);
    const nt = await cdp.openPage('chrome://newtab/');
    const lbl = await cdp.waitFor(nt.sessionId, `document.querySelector('[data-testid=customize]')?.textContent.trim()`);
    check('other pages follow the language setting', lbl === 'Özelleştir', lbl);
    await cdp.evaluate(cc.sessionId, `(() => { location.hash = 'dashboard'; return true; })()`);
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-testid=suspender-stats]') !== null`);
    await sleep(500);
    await shot(cc.sessionId, '18-cc-dashboard-tr.png');
    await cdp.evaluate(cc.sessionId, `(() => { location.hash = 'modules'; return true; })()`);
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-module-toggle=tab-suspender]') !== null`);
    await cdp.evaluate(cc.sessionId, `[...document.querySelectorAll('.module-select')].find(b => b.textContent.includes('Uyutucu')).click() || true`);
    await sleep(400);
    await shot(cc.sessionId, '19-cc-modules-tr.png');
    await cdp.evaluate(cc.sessionId, `(() => { location.hash = 'advanced'; return true; })()`);
    await cdp.waitFor(cc.sessionId, `document.querySelector('[data-testid=language]') !== null`);
    await cdp.evaluate(cc.sessionId, `(() => { const s = document.querySelector('[data-testid=language]'); s.value = 'auto'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const back = await cdp.waitFor(cc.sessionId, `document.querySelector('[data-section=dashboard]').textContent.trim() === 'Dashboard'`);
    check('auto language follows the browser locale (en here)', back);
  });
} catch (err) {
  check('unexpected error', false, err.stack ?? String(err));
} finally {
  if (browser) await closeBrowser(browser);
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(media, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
writeFileSync(join(shots, 'results-features.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} feature checks passed; screenshots in ${shots}`);
process.exit(failed.length ? 1 : 0);
