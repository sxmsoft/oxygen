#!/usr/bin/env node
// Headless performance measurements for Oxygen (CPU of the whole browser
// process group sampled from /proc, PSS memory, storage writes and long tasks
// during a widget drag, service worker lifetime, shutdown).
//
// node tests/perf/measure.mjs --ext DIR|none [--profile-copy DIR] [--label X] [--json OUT]
//   --profile-copy  a COPY of a real profile; it is copied again to a temp dir, never modified
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, sleep } from '../e2e/cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const binary = opt('--binary', '/opt/helium-browser-bin/helium');
const ext = opt('--ext', 'none');
const copy = opt('--profile-copy', null);
const label = opt('--label', ext === 'none' ? 'bare' : 'oxygen');
const only = opt('--only', 'startup,idle,background,drag,sw,ram,close').split(',');
const EXT_ID = 'nngdpmabmapeoinhapfmhboloceopgic';
const HZ = 100;

function groupPids(pgid) {
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = readFileSync(`/proc/${d}/stat`, 'utf8');
      const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
      if (Number(f[2]) === pgid) out.push({ pid: Number(d), ticks: Number(f[11]) + Number(f[12]) });
    } catch {}
  }
  return out;
}
/** CPU ticks per process type (browser, renderer, gpu-process, utility...) */
function byType(pgid) {
  const out = {};
  for (const { pid, ticks } of groupPids(pgid)) {
    let type = 'browser';
    try {
      type = /--type=([\w-]+)/.exec(readFileSync(`/proc/${pid}/cmdline`, 'utf8'))?.[1] ?? 'browser';
      if (type === 'renderer' && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--extension-process')) type = 'renderer(ext)';
    } catch {}
    out[type] = (out[type] ?? 0) + ticks;
  }
  return out;
}
const cpuTicks = (pgid) => groupPids(pgid).reduce((a, p) => a + p.ticks, 0);
function pssMb(pgid) {
  let kb = 0;
  for (const { pid } of groupPids(pgid)) {
    try {
      kb += Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] ?? 0);
    } catch {}
  }
  return Math.round(kb / 1024);
}
/** CPU % of one core used by the whole browser during `ms`. */
async function cpuOver(pgid, ms) {
  const a = cpuTicks(pgid), t = Date.now();
  await sleep(ms);
  return Math.round((((cpuTicks(pgid) - a) / HZ) * 1000 * 100) / (Date.now() - t)) ;
}

const profile = mkdtempSync(join(tmpdir(), 'oxygen-perf-'));
if (copy) cpSync(copy, profile, { recursive: true });
rmSync(join(profile, 'DevToolsActivePort'), { force: true });
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(profile, f), { force: true });
const env = { LANG: 'tr_TR.UTF-8', LANGUAGE: 'tr_TR', LC_ALL: 'tr_TR.UTF-8' };
const t0 = Date.now();
const b = await launchBrowser({ binary, profileDir: profile, extensions: ext === 'none' ? [] : [ext], env, startUrl: 'chrome://newtab/' });
const pg = b.pid;
const { cdp } = b;
const R = { label, profile: copy ? 'his-copy' : 'temp' };
const EXT = (p) => `chrome-extension://${EXT_ID}/${p}`;
const evalT = (s, e, ms = 5000) => Promise.race([cdp.evaluate(s, e), sleep(ms).then(() => { throw new Error('page not responding (' + ms + ' ms)'); })]);

try {
  if (only.includes('startup')) {
    await sleep(Math.max(0, 15000 - (Date.now() - t0)));
    R.startupCpuSec = +(cpuTicks(pg) / HZ).toFixed(1);
    R.procsAtStartup = groupPids(pg).length;
  }
  // the start tab (Oxygen new tab when the extension is loaded)
  const startTab = (await cdp.targets()).find((t) => t.type === 'page');
  if (only.includes('idle')) {
    await sleep(Math.max(0, 30000 - (Date.now() - t0))); // let first-run browser work settle
    let ps = null;
    if (startTab) {
      ps = await cdp.attach(startTab.targetId).catch(() => null);
      if (ps) await cdp.send('Performance.enable', {}, ps).catch(() => (ps = null));
    }
    const metric = async () => (ps ? Object.fromEntries((await cdp.send('Performance.getMetrics', {}, ps)).metrics.map((m) => [m.name, m.value])) : null);
    const m0 = await metric();
    const before = byType(pg), t = Date.now();
    R.idleNewtabCpuPct = await cpuOver(pg, 20000);
    const after = byType(pg), dt = (Date.now() - t) / 1000;
    const m1 = await metric();
    if (m0 && m1) {
      R.startTabUrl = startTab.url.replace(/^chrome-extension:\/\/[a-z]+/, 'ext:');
      R.newtabMainThreadPct = +(((m1.TaskDuration - m0.TaskDuration) / dt) * 100).toFixed(1);
    }
    R.idleByProcessPct = Object.fromEntries(Object.keys(after).map((k) => [k, Math.round(((after[k] - (before[k] ?? 0)) / HZ / dt) * 100)]).filter(([, v]) => v > 0));
  }
  if (only.includes('ram')) R.pssMb = pssMb(pg);

  if (only.includes('background') && startTab) {
    const other = await cdp.openPage('about:blank');
    await cdp.send('Target.activateTarget', { targetId: other.targetId });
    await sleep(2000);
    R.newtabInBackgroundCpuPct = await cpuOver(pg, 15000);
    await cdp.send('Target.closeTarget', { targetId: other.targetId });
    await cdp.send('Target.activateTarget', { targetId: startTab.targetId });
  }

  if (only.includes('drag') && ext !== 'none') {
    const nt = await cdp.openPage(EXT('newtab.html'));
    const s = nt.sessionId;
    await cdp.send('Target.activateTarget', { targetId: nt.targetId });
    await cdp.waitFor(s, `document.querySelectorAll('.widget').length > 2 && !!document.querySelector('[data-testid=customize]')`, 15000);
    // second Oxygen tab listening for storage changes (cross-tab echo)
    const nt2 = await cdp.openPage(EXT('newtab.html'));
    await cdp.waitFor(nt2.sessionId, `document.querySelectorAll('.widget').length > 2`, 15000);
    await cdp.send('Target.activateTarget', { targetId: nt.targetId });
    const probe = `(() => { window.__w = 0; window.__lt = []; window.__keys = {}; chrome.storage.onChanged.addListener((c) => { for (const k in c) window.__keys[k] = (window.__keys[k] ?? 0) + 1; if ('oxygen.newtab.layout' in c) window.__w++; });
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false }); return true; })()`;
    await cdp.evaluate(s, probe);
    await cdp.evaluate(nt2.sessionId, probe);
    await cdp.evaluate(s, `document.querySelector('[data-testid=customize]').click() || true`);
    await sleep(800);
    const r = await cdp.evaluate(s, `(() => { const w = document.querySelector('[data-widget-type=clock]') ?? document.querySelector('.widget'); const c = w.querySelector('.chrome').getBoundingClientRect(); return [c.left + 20, c.top + c.height / 2, w.dataset.widgetType]; })()`);
    R.dragWidget = r[2];
    const mouse = (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, s);
    const a = cpuTicks(pg), t = Date.now();
    let froze = false;
    try {
      await Promise.race([
        (async () => {
          await mouse('mousePressed', r[0], r[1]);
          // 200 moves: to the far left, then down and back (crosses every other widget)
          for (let i = 1; i <= 200; i++) {
            const k = i / 200;
            const x = r[0] - Math.sin(k * Math.PI) * r[0] * 0.95;
            const y = r[1] + Math.sin(k * Math.PI * 2) * 260 + k * 120;
            await mouse('mouseMoved', Math.max(5, x), Math.max(5, y));
          }
          await mouse('mouseMoved', 30, r[1] + 120);
          await sleep(100);
          await mouse('mouseReleased', 30, r[1] + 120);
        })(),
        sleep(20000).then(() => { throw new Error('freeze'); }),
      ]);
      await evalT(s, '1', 5000);
    } catch {
      froze = true;
    }
    const dt = Date.now() - t;
    R.dragFroze = froze;
    R.dragMs = dt;
    R.dragCpuPct = Math.round((((cpuTicks(pg) - a) / HZ) * 1000 * 100) / dt);
    if (!froze) {
      await sleep(1200);
      const st = await evalT(s, `({ w: window.__w, lt: window.__lt, keys: window.__keys })`);
      R.dragAllKeyChanges = st.keys;
      const st2 = await evalT(nt2.sessionId, `({ w: window.__w })`);
      R.dragStorageWrites = st.w;
      R.dragMoved = await evalT(s, `chrome.storage.local.get('oxygen.newtab.layout').then(r => { const c = (r['oxygen.newtab.layout'] ?? []).find(w => w.type === ${JSON.stringify(r[2])}); return c ? c.x + ',' + c.y : 'not saved'; })`);
      R.dragOtherTabChanges = st2.w;
      R.dragLongTasks = st.lt.length;
      R.dragMaxLongTaskMs = Math.max(0, ...st.lt);
      // echo check: no writes keep coming after the drop
      const w0 = st.w;
      await sleep(3000);
      R.writesAfterDrop = (await evalT(s, 'window.__w')) - w0;
    } else {
      R.pssMbWhileFrozen = pssMb(pg);
      R.frozenCpuPct = await cpuOver(pg, 5000);
    }
    await cdp.send('Target.closeTarget', { targetId: nt2.targetId }).catch(() => {});
    R.__frozenTarget = froze ? nt.targetId : null;
    if (!froze) await cdp.send('Target.closeTarget', { targetId: nt.targetId }).catch(() => {});
  }

  if (only.includes('sw') && ext !== 'none') {
    // leave only a plain page open, then time how long the worker stays alive
    // wake the worker with a message from an Oxygen page, then leave only a plain page
    const wake = await cdp.openPage(EXT('newtab.html'));
    await cdp.waitFor(wake.sessionId, `chrome.runtime.sendMessage({ type: 'oxygen:build' }).then(r => !!r?.build)`, 10000).catch(() => {});
    R.swAliveAtStart = (await cdp.targets()).some((t) => t.type === 'service_worker' && t.url.includes(EXT_ID));
    const blank = await cdp.openPage('about:blank');
    for (const t of await cdp.targets()) if (t.type === 'page' && t.targetId !== blank.targetId && t.targetId !== R.__frozenTarget) await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    const st = Date.now();
    let alive = true;
    while (Date.now() - st < 90000) {
      alive = (await cdp.targets()).some((t) => t.type === 'service_worker' && t.url.includes(EXT_ID));
      if (!alive) break;
      await sleep(1000);
    }
    R.swAliveAfterIdleSec = alive ? '>90' : Math.round((Date.now() - st) / 1000);
    R.idleNoOxygenPagesCpuPct = Math.max(0, await cpuOver(pg, 10000));
  }

  if (only.includes('close')) {
    R.procsBeforeClose = groupPids(pg).length;
    await Promise.race([cdp.send('Browser.close'), sleep(5000)]).catch(() => {});
    const st = Date.now();
    while (Date.now() - st < 20000 && groupPids(pg).length) await sleep(250);
    R.procsLeft5sAfterClose = groupPids(pg).length;
    R.closeSec = groupPids(pg).length ? '>20' : +((Date.now() - st) / 1000).toFixed(1);
  }
} catch (e) {
  R.error = String(e?.message ?? e);
} finally {
  cdp.close();
  if (groupPids(pg).length) {
    R.leftoverKilled = groupPids(pg).length;
    try { process.kill(-pg, 'SIGKILL'); } catch {}
  }
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
delete R.__frozenTarget;
console.log(JSON.stringify(R));
if (opt('--json', null)) writeFileSync(opt('--json'), JSON.stringify(R, null, 2));
