#!/usr/bin/env node
// Headless performance regression checks (thresholds, not exact numbers):
// a 200-move widget drag must not freeze or write storage per move, another
// Oxygen tab must not echo writes back, the new tab must idle cheaply, and the
// service worker must go idle. Uses tests/perf/measure.mjs on a temp profile.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageExtension } from './cdp.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const binary = opt('--binary', process.env.HELIUM_BIN ?? '/opt/helium-browser-bin/helium');
const shots = resolve(opt('--shots', join(repo, 'dist/e2e')));
mkdirSync(shots, { recursive: true });
const ext = stageExtension(join(repo, 'dist/extension'));
const out = join(shots, 'perf-measure.json');
execFileSync('node', [join(repo, 'tests/perf/measure.mjs'), '--binary', binary, '--ext', ext, '--label', 'verify', '--json', out, '--only', 'idle,drag,sw,close'], { stdio: 'inherit', timeout: 300_000 });
const m = JSON.parse(readFileSync(out, 'utf8'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${JSON.stringify(detail)}`);
};
check('no error while measuring', !m.error, m.error ?? '');
check('200-move clock drag does not freeze the page', m.dragFroze === false, { froze: m.dragFroze, ms: m.dragMs });
check('drop is saved, with at most 2 storage writes for 200 moves', m.dragStorageWrites >= 1 && m.dragStorageWrites <= 2 && String(m.dragMoved).startsWith('0,'), { writes: m.dragStorageWrites, clockAt: m.dragMoved });
check('no long task over 200 ms during the drag', m.dragMaxLongTaskMs < 200, { count: m.dragLongTasks, max: m.dragMaxLongTaskMs });
check('no cross-tab echo: nothing written after the drop', m.writesAfterDrop === 0, m.writesAfterDrop);
check('the other Oxygen tab sees only the drop', m.dragOtherTabChanges >= 1 && m.dragOtherTabChanges <= 2, m.dragOtherTabChanges);
check('idle new tab: main thread < 3% and GPU process < 10% of a core', m.newtabMainThreadPct < 3 && (m.idleByProcessPct?.['gpu-process'] ?? 0) < 10, { mainThread: m.newtabMainThreadPct, byProcess: m.idleByProcessPct });
check('service worker stops within ~40 s of idle', m.swAliveAtStart && typeof m.swAliveAfterIdleSec === 'number' && m.swAliveAfterIdleSec <= 45, { aliveAtStart: m.swAliveAtStart, stoppedAfterSec: m.swAliveAfterIdleSec });
check('browser exits with no leftover processes', m.procsLeft5sAfterClose === 0 && !m.leftoverKilled, { left: m.procsLeft5sAfterClose, closeSec: m.closeSec });

const passed = results.filter((r) => r.ok).length;
writeFileSync(join(shots, 'results-perf.json'), JSON.stringify(results, null, 2));
console.log(`\n${passed}/${results.length} perf checks passed`);
process.exit(passed === results.length ? 0 : 1);
