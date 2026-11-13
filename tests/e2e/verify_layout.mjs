#!/usr/bin/env node
// Headless e2e: new tab layout customization (presets, columns, rows, gap,
// width, frames, persistence, reset) and quick-link icons (sharper site icon
// fetched + cached, letter fallback, emoji, custom image upload, rename,
// drag reorder, icons kept across a Helium re-import). Throwaway profiles only.
//
// Usage: node tests/e2e/verify_layout.mjs [--binary PATH] [--shots DIR]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
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

// ---- tiny PNG encoder (solid color) ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(size, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 127.0.0.1 = a site with an apple-touch-icon; localhost = a site without any icon.
const hits = { page: 0, icon: 0 };
const server = createServer((req, res) => {
  const iconSite = (req.headers.host ?? '').startsWith('127.0.0.1');
  if (req.url === '/' && iconSite) {
    hits.page++;
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><link rel="icon" href="/fav16.png" sizes="16x16"><link rel="apple-touch-icon" href="/touch.png"></head><body>icon site</body></html>');
  } else if (req.url === '/touch.png' && iconSite) {
    hits.icon++;
    res.writeHead(200, { 'content-type': 'image/png' }).end(png(180, [220, 40, 60]));
  } else if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>no icons</body></html>');
  } else res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// the "localhost" site must resolve to this server too
const ICON_SITE = `http://127.0.0.1:${port}/app?x=1`;
const PLAIN_SITE = `http://localhost:${port}/`;

const tmp = mkdtempSync(join(tmpdir(), 'oxygen-e2e-layout-'));
const uploadPng = join(tmp, 'custom.png');
writeFileSync(uploadPng, png(300, [40, 160, 90]));

const fixture = join(repo, 'tests/fixtures/helium-Preferences.json');
const ext = stageExtension(join(repo, 'dist/extension'));
execFileSync('node', [join(repo, 'scripts/import_shortcuts.mjs'), '--preferences', fixture, '--out', join(tmp, 'import.json'), '--dist', ext], { stdio: 'ignore' });
const env = { LANG: 'en_US.UTF-8', LANGUAGE: 'en_US', LC_ALL: 'en_US.UTF-8' };
const profile = mkdtempSync(join(tmpdir(), 'oxygen-e2e-layout-profile-'));
const browser = await launchBrowser({ binary, profileDir: profile, extensions: [ext], env });

const get = (k) => `chrome.storage.local.get(${JSON.stringify(k)}).then(r => r[${JSON.stringify(k)}])`;
try {
  const { cdp } = browser;
  const swT = await cdp.waitForTarget((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
  const sw = await cdp.attach(swT.targetId);
  await cdp.send('Runtime.runIfWaitingForDebugger', {}, sw).catch(() => {});
  await cdp.waitFor(sw, `typeof chrome !== 'undefined' && !!self.oxygenTest`);
  const ev = (e) => cdp.evaluate(sw, e);
  const EXT = (p) => `chrome-extension://${new URL(swT.url).host}/${p}`;
  await cdp.waitFor(sw, `${get('oxygen.links')}.then(l => (l ?? []).length === 5)`, 10000);
  // Two extra links of our own: a site with a touch icon and one without any icon.
  await ev(`${get('oxygen.links')}.then(l => chrome.storage.local.set({ 'oxygen.links': [...l, { id: 'u-icon', title: 'Icon Site', url: ${JSON.stringify(ICON_SITE)} }, { id: 'u-plain', title: 'plain', url: ${JSON.stringify(PLAIN_SITE)} }] }))`);

  const nt = await cdp.openPage(EXT('newtab.html'));
  const s = nt.sessionId;
  const pe = (e) => cdp.evaluate(s, e);
  await cdp.waitFor(s, `document.querySelectorAll('[data-testid=link-tile]').length === 7`, 10000);
  const click = (sel) => pe(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
  const setInput = (sel, v, evName = 'change') => pe(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(String(v))}; e.dispatchEvent(new Event(${JSON.stringify(evName)}, { bubbles: true })); return true; })()`);
  const tileIcon = (id) => pe(`document.querySelector('[data-link-id=${id}] [data-icon-source]')?.dataset.iconSource`);

  await step('quick-link icons', async () => {
    const hi = await cdp.waitFor(s, `document.querySelector('[data-link-id=u-icon] [data-icon-source]')?.dataset.iconSource === 'hires' && document.querySelector('[data-link-id=u-icon] img').src`, 15000);
    check('site with apple-touch-icon gets the sharp icon (fetched, as blob)', String(hi).startsWith('blob:'), hi);
    const letter = await cdp.waitFor(s, `document.querySelector('[data-link-id=u-plain] [data-icon-source]')?.dataset.iconSource === 'letter' && document.querySelector('[data-link-id=u-plain] .tile').textContent`, 15000);
    check('site without any icon gets a letter tile', letter === 'P', letter);
    const cached = await pe(`new Promise(r => { const q = indexedDB.open('oxygen-icons'); q.onsuccess = () => { const g = q.result.transaction('fetched').objectStore('fetched').getAll(); g.onsuccess = () => r(g.result.map(x => [x.origin, !!x.blob])); }; })`);
    check('icons cached in IndexedDB (hit + negative cache), only origins requested', cached.some(([o, b]) => o === `http://127.0.0.1:${port}` && b) && cached.some(([o, b]) => o === `http://localhost:${port}` && !b), cached);
    const before = { ...hits };
    await cdp.send('Page.reload', {}, s);
    await cdp.waitFor(s, `document.querySelector('[data-link-id=u-icon] [data-icon-source]')?.dataset.iconSource === 'hires'`, 10000);
    check('cached icon reused after reload (no refetch)', hits.page === before.page && hits.icon === before.icon, { before, after: hits });
  });

  await step('edit dialog: rename + emoji icon', async () => {
    await click('[data-link-id=u-plain] [data-testid=link-edit]');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=link-dialog]')`);
    await setInput('[data-testid=link-title]', 'Plain Site', 'input');
    await click('[data-testid=icon-kind-emoji]');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=icon-text]')`);
    await setInput('[data-testid=icon-text]', '🎮', 'input');
    await click('[data-testid=link-save]');
    const l = await cdp.waitFor(sw, `${get('oxygen.links')}.then(l => { const x = l.find(x => x.id === 'u-plain'); return x.title === 'Plain Site' && x; })`, 5000);
    check('rename + emoji icon saved', l.icon?.kind === 'emoji' && l.icon.text === '🎮', l.icon);
    check('tile shows the emoji', (await tileIcon('u-plain')) === 'emoji' && (await pe(`document.querySelector('[data-link-id=u-plain] .tile').textContent`)) === '🎮');
  });

  await step('custom image icon', async () => {
    await click('[data-link-id=u-icon] [data-testid=link-edit]');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=link-dialog]')`);
    await click('[data-testid=icon-kind-image]');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=icon-upload]')`);
    const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-testid=icon-upload]')` }, s);
    await cdp.send('DOM.setFileInputFiles', { files: [uploadPng], objectId: result.objectId }, s);
    await cdp.waitFor(s, `document.querySelector('[data-testid=link-dialog] [data-icon-source]')?.dataset.iconSource === 'custom'`, 5000);
    await click('[data-testid=link-save]');
    const ic = await cdp.waitFor(sw, `${get('oxygen.links')}.then(l => l.find(x => x.id === 'u-icon').icon)`, 5000);
    check('uploaded image saved as the icon', ic.kind === 'image' && /^ic-/.test(ic.id), ic);
    const dim = await pe(`new Promise(r => { const q = indexedDB.open('oxygen-icons'); q.onsuccess = () => { const g = q.result.transaction('custom').objectStore('custom').get(${JSON.stringify(ic.id)}); g.onsuccess = () => createImageBitmap(g.result).then(b => r([b.width, b.height, g.result.type])); }; })`);
    check('image stored in IndexedDB, resized to 128px PNG', JSON.stringify(dim) === JSON.stringify([128, 128, 'image/png']), dim);
    await cdp.waitFor(s, `document.querySelector('[data-link-id=u-icon] [data-icon-source]')?.dataset.iconSource === 'custom'`, 5000);
  });

  await step('re-import keeps custom icons', async () => {
    // give an imported (Helium) shortcut an emoji, then force a re-import
    await ev(`${get('oxygen.links')}.then(l => chrome.storage.local.set({ 'oxygen.links': l.map((x, i) => i === 0 ? { ...x, icon: { kind: 'letter', text: 'V', bg: '#bf616a' } } : x) }))`);
    await ev(`self.oxygenTest.ingestShortcuts(true)`);
    const l = await ev(get('oxygen.links'));
    check('Helium re-import keeps chosen icons and user links', l[0].icon?.kind === 'letter' && l.find((x) => x.id === 'u-icon')?.icon?.kind === 'image' && l.length === 7, l.map((x) => x.icon?.kind ?? 'auto'));
  });

  await step('quick-link tile settings', async () => {
    await click('[data-testid=customize]');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=customize-drawer]')`);
    await click('[data-widget-type=links] .chrome button[aria-label=Settings]');
    await cdp.waitFor(s, `!!document.querySelector('[data-widget-type=links] [data-testid=widget-settings]')`);
    await setInput('[data-widget-type=links] [data-setting=iconSize]', 64);
    await setInput('[data-widget-type=links] [data-setting=shape]', 'circle');
    await sleep(300);
    const box = await pe(`(() => { const e = document.querySelector('[data-link-id=u-icon] .ic'); const c = getComputedStyle(e); return [e.getBoundingClientRect().width, c.borderTopLeftRadius]; })()`);
    check('icon size + circle shape applied', box[0] === 64 && box[1] === '50%', box);
    await click('[data-widget-type=links] [data-testid=widget-settings] input[type=checkbox]');
    await cdp.waitFor(s, `!document.querySelector('[data-widget-type=links] [data-link-id] .name')`, 3000);
    check('labels can be hidden', true);
    await click('[data-widget-type=links] [data-testid=widget-settings] input[type=checkbox]');
    const st = await ev(`${get('oxygen.newtab.layout')}.then(l => l.find(w => w.type === 'links').settings)`);
    check('tile settings persisted on the widget', st.iconSize === 64 && st.shape === 'circle' && st.showLabels === true, st);
    await click('[data-widget-type=links] .chrome button[aria-label=Settings]');
  });

  await step('drag reorder (edit mode)', async () => {
    const order0 = await pe(`[...document.querySelectorAll('[data-link-id]')].map(e => e.dataset.linkId)`);
    const r = await pe(`[0, 2].map(i => { const b = document.querySelectorAll('[data-link-id]')[i].getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width]; })`);
    const mouse = (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, s);
    await mouse('mousePressed', r[0][0], r[0][1]);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', r[0][0] + ((r[1][0] + r[1][2] * 0.3 - r[0][0]) * i) / 8, r[0][1]);
    await mouse('mouseReleased', r[1][0] + r[1][2] * 0.3, r[1][1]);
    const l = await cdp.waitFor(sw, `${get('oxygen.links')}.then(l => l[0].id !== ${JSON.stringify(order0[0])} && l.map(x => x.id))`, 4000);
    check('dragging the first tile past the third reorders and saves', l[2] === order0[0] && l[0] === order0[1], { before: order0.slice(0, 3), after: l.slice(0, 3) });
  });

  await step('layout presets + undo', async () => {
    const n0 = (await ev(get('oxygen.newtab.layout'))).length;
    await click('[data-testid=preset-helium]');
    const g = await cdp.waitFor(sw, `${get('oxygen.newtab.grid')}.then(g => g && g.frames === 'none' && g)`, 4000);
    const l = await ev(get('oxygen.newtab.layout'));
    check('Helium-like preset: centered narrow tiles, search + links only', g.maxWidth === 760 && l.length === 2 && l.find((w) => w.type === 'links').settings.align === 'center', { g, types: l.map((w) => w.type) });
    await sleep(400);
    const frames = await pe(`[...document.querySelectorAll('.widget')].map(e => e.className.match(/frame-\\w+/)[0])`);
    check('widget frames follow the preset (per-widget override for search)', frames.includes('frame-none') && frames.includes('frame-glass'), frames);
    await click('[data-testid=preset-minimal]');
    await cdp.waitFor(sw, `${get('oxygen.newtab.layout')}.then(l => l.some(w => w.type === 'clock') && l.length === 3)`, 4000);
    check('Minimal preset applied', true);
    await click('[data-testid=preset-undo]');
    const back = await cdp.waitFor(sw, `${get('oxygen.newtab.layout')}.then(l => l.length === 2 && l)`, 4000);
    check('undo restores the previous arrangement', back.length === 2);
    await click('[data-testid=preset-dashboard]');
    await cdp.waitFor(sw, `${get('oxygen.newtab.layout')}.then(l => l.length === 7)`, 4000);
    check('Dashboard preset restores all widgets', n0 >= 7);
  });

  await step('grid columns / rows / gap / width', async () => {
    await setInput('[data-testid=grid-columns]', 24);
    await cdp.waitFor(s, `document.querySelector('[data-testid=newtab]').dataset.columns === '24'`, 4000);
    const l = await ev(get('oxygen.newtab.layout'));
    const links = l.find((w) => w.type === 'links');
    const overlap = l.some((a) => l.some((b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
    check('24 columns: widgets rescaled, no overlaps', links.w === 16 && !overlap && l.every((w) => w.x + w.w <= 24), l.map((w) => [w.type, w.x, w.w]));
    await setInput('[data-testid=grid-gap]', 24, 'input');
    await setInput('[data-testid=grid-maxwidth]', 440, 'input');
    await setInput('[data-testid=grid-align]', 'start');
    await setInput('[data-testid=grid-rowmode]', 'fit');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=grid-rows]')`);
    await setInput('[data-testid=grid-rows]', 6, 'input');
    const g = await cdp.waitFor(sw, `${get('oxygen.newtab.grid')}.then(g => g.rows === 6 && g.gap === 24 && g)`, 4000);
    check('gap, full width, alignment and fit-to-window rows saved', g.maxWidth === 0 && g.align === 'start' && g.rowMode === 'fit' && g.columns === 24, g);
    const geo = await pe(`(() => { const w = [...document.querySelectorAll('.widget')]; const page = document.querySelector('[data-testid=newtab]').getBoundingClientRect(); const top = Math.min(...w.map(e => e.getBoundingClientRect().top)); const rowEl = w.find(e => e.dataset.widgetType === 'search'); return { pageW: Math.round(page.width), rowH: Math.round(rowEl.getBoundingClientRect().height), vh: innerHeight, top: Math.round(top) }; })()`);
    const expectRow = Math.floor((geo.vh - (18 + 52 + (geo.vh * 6) / 100) - 32 - 24 * 5) / 6);
    check('full width page and rows fit the window', geo.pageW >= 1230 && Math.abs(geo.rowH - expectRow) <= 2, { ...geo, expectRow });
    writeFileSync(join(shots, '24-layout-panel.png'), await cdp.screenshot(s));
  });

  await step('persistence + reset', async () => {
    await cdp.send('Page.reload', {}, s);
    await cdp.waitFor(s, `document.querySelector('[data-testid=newtab]')?.dataset.columns === '24' && document.querySelectorAll('.widget').length === 7`, 8000);
    check('layout + grid survive a reload', true);
    await click('[data-testid=customize]');
    await cdp.waitFor(s, `!!document.querySelector('[data-testid=reset-all]')`);
    await click('[data-testid=reset-all]');
    const g = await cdp.waitFor(sw, `${get('oxygen.newtab.grid')}.then(g => g.columns === 12 && g)`, 4000);
    check('reset restores default grid (12 cols, 14px gap, 1240px, fixed rows)', g.gap === 14 && g.maxWidth === 1240 && g.rowMode === 'fixed' && g.frames === 'glass', g);
    const l = await ev(get('oxygen.newtab.layout'));
    check('reset restores the default widgets', l.length === 7 && l.find((w) => w.type === 'links').w === 8);
    const links = await ev(get('oxygen.links'));
    check('quick links (and their icons) untouched by layout reset', links.length === 7 && links.some((x) => x.icon?.kind === 'image'));
    await click('[data-testid=customize]');
    await sleep(600);
    writeFileSync(join(shots, '25-quicklinks-icons.png'), await cdp.screenshot(s));
  });
} finally {
  await closeBrowser(browser);
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(join(shots, 'results-layout.json'), JSON.stringify(results, null, 2));
console.log(`\n${passed}/${results.length} layout checks passed; screenshots in ${shots}`);
process.exit(passed === results.length ? 0 : 1);
