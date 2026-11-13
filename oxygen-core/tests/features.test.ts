import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suspendDecision, estimateSavedMb, type SuspenderConfig } from '../../extension/src/logic/suspender.js';
import { parseDomainList, hostMatches } from '../../extension/src/logic/domains.js';
import {
  captureWindow, makeWorkspace, exportWorkspaces, parseWorkspacesImport, mergeImported, upsertWorkspace,
  EMPTY_STORE, tabCount, parseStore,
} from '../../extension/src/logic/workspace.js';
import { matchRules, ruleMatches, normalizePattern, cssFor, toggleDarkForHost, parseRules, DARK_MODE_CSS, type SiteRule } from '../../extension/src/logic/siteRules.js';
import { addWidget, moveWidget, resizeWidget, removeWidget, parseLayout, collides, updateWidgetSettings, type WidgetSizeDef, type Layout } from '../../extension/src/logic/layout.js';
import { renderMarkdown } from '../../extension/src/logic/markdown.js';
import { rank } from '../../extension/src/logic/search.js';
import { resolveLocale, translate, missingKeys } from '../../extension/src/logic/i18n.js';
import { isModuleEnabled, moduleConfig } from '../../extension/src/logic/moduleState.js';
import { FEATURE_MANIFESTS, suspenderManifest } from '../../extension/src/modules/manifests.js';
import { validateManifest } from '../../sdk/src/validator.js';

const cfg: SuspenderConfig = { idleMinutes: 10, excludePinned: true, excludeAudible: true, whitelist: 'mail.example.com, *.docs.io' };
const now = 1_000_000_000;
const idle = { url: 'https://news.site/a', pinned: false, audible: false, active: false, discarded: false, lastAccessed: now - 11 * 60_000 };

test('suspender: idle background tab is suspended', () => {
  assert.deepEqual(suspendDecision(idle, cfg, now), { suspend: true });
});

test('suspender: exclusions', () => {
  assert.equal((suspendDecision({ ...idle, active: true }, cfg, now) as { reason: string }).reason, 'active');
  assert.equal((suspendDecision({ ...idle, pinned: true }, cfg, now) as { reason: string }).reason, 'pinned');
  assert.equal((suspendDecision({ ...idle, audible: true }, cfg, now) as { reason: string }).reason, 'audible');
  assert.equal((suspendDecision({ ...idle, discarded: true }, cfg, now) as { reason: string }).reason, 'discarded');
  assert.equal((suspendDecision({ ...idle, url: 'chrome://settings' }, cfg, now) as { reason: string }).reason, 'unsupported-url');
  assert.equal((suspendDecision({ ...idle, url: 'https://mail.example.com/x' }, cfg, now) as { reason: string }).reason, 'whitelisted');
  assert.equal((suspendDecision({ ...idle, url: 'https://a.docs.io/' }, cfg, now) as { reason: string }).reason, 'whitelisted');
  // exclusions can be turned off
  assert.deepEqual(suspendDecision({ ...idle, pinned: true }, { ...cfg, excludePinned: false }, now), { suspend: true });
  assert.deepEqual(suspendDecision({ ...idle, audible: true }, { ...cfg, excludeAudible: false }, now), { suspend: true });
});

test('suspender: not yet idle reports due time', () => {
  const d = suspendDecision({ ...idle, lastAccessed: now - 60_000 }, cfg, now);
  assert.equal(d.suspend, false);
  assert.equal((d as { dueAt: number }).dueAt, now - 60_000 + 10 * 60_000);
  assert.equal(estimateSavedMb(3), 150);
});

test('domains: list parsing and matching', () => {
  assert.deepEqual(parseDomainList('https://www.A.com/x, b.org;b.org  *.c.net'), ['www.a.com', 'b.org', 'c.net']);
  assert.ok(hostMatches('x.b.org', 'b.org'));
  assert.ok(!hostMatches('notb.org', 'b.org'));
});

test('workspace: capture keeps groups, colors, pinned; drops internal pages', () => {
  const win = captureWindow(
    [
      { url: 'https://a.com', title: 'A', pinned: true, groupId: -1 },
      { url: 'chrome://newtab/', pinned: false },
      { url: 'https://b.com', title: 'B', pinned: false, groupId: 7 },
      { pendingUrl: 'https://c.com', pinned: false, groupId: 7 },
      { url: 'https://d.com', pinned: false, groupId: 9 },
    ],
    [
      { id: 7, title: 'Work', color: 'blue', collapsed: false },
      { id: 9, title: 'Odd', color: 'not-a-color', collapsed: true },
    ]
  );
  assert.equal(win.tabs.length, 4);
  assert.deepEqual(win.groups, [{ title: 'Work', color: 'blue', collapsed: undefined }, { title: 'Odd', color: 'grey', collapsed: true }]);
  assert.equal(win.tabs[0].pinned, true);
  assert.equal(win.tabs[1].group, 0);
  assert.equal(win.tabs[2].group, 0);
  assert.equal(win.tabs[3].group, 1);
});

test('workspace: export → import round trip and sanitization', () => {
  const ws = makeWorkspace('Research', [captureWindow([{ url: 'https://a.com', title: 'A', pinned: false, groupId: 1 }], [{ id: 1, title: 'G', color: 'red', collapsed: false }])], now, 'ws-1');
  const json = exportWorkspaces([ws]);
  const back = parseWorkspacesImport(json, now);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify([ws])));
  assert.equal(tabCount(back[0]), 1);
  // single workspace object is accepted; bad URLs/groups stripped
  const single = parseWorkspacesImport(
    JSON.stringify({ name: 'X', windows: [{ tabs: [{ url: 'javascript:alert(1)' }, { url: 'https://ok.com', group: 5 }], groups: [] }] }),
    now
  );
  assert.equal(single[0].windows[0].tabs.length, 1);
  assert.equal(single[0].windows[0].tabs[0].group, undefined);
  assert.throws(() => parseWorkspacesImport('{nope', now), /Invalid JSON/);
  assert.throws(() => parseWorkspacesImport('{"foo":1}', now), /Not an Oxygen/);
  assert.throws(() => parseWorkspacesImport(JSON.stringify({ windows: [{ tabs: [{ url: 'chrome://x' }] }] }), now), /No restorable/);
});

test('workspace: store upsert/merge never overwrites existing ids', () => {
  const ws = makeWorkspace('One', [{ tabs: [{ url: 'https://a.com' }], groups: [] }], now, 'same');
  let store = upsertWorkspace({ ...EMPTY_STORE }, ws);
  store = upsertWorkspace(store, { ...ws, name: 'One v2' });
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].name, 'One v2');
  store = mergeImported(store, [ws], now);
  assert.equal(store.saved.length, 2);
  assert.notEqual(store.saved[0].id, store.saved[1].id);
  assert.deepEqual(parseStore(null), EMPTY_STORE);
});

const rules: SiteRule[] = [
  { id: 'r1', pattern: 'example.com', enabled: true, zoom: 1.25, forceDark: false, css: '' },
  { id: 'r2', pattern: 'example.com/docs', enabled: true, zoom: 0.9, forceDark: true, css: 'body{font-size:18px}' },
  { id: 'r3', pattern: 'other.org', enabled: false, zoom: 2, forceDark: true, css: '' },
];

test('site rules: host + path matching, most specific zoom wins', () => {
  assert.equal(normalizePattern('https://WWW.Example.com/docs/*'), 'www.example.com/docs');
  assert.ok(ruleMatches(rules[0], 'https://sub.example.com/x'));
  assert.ok(!ruleMatches(rules[0], 'https://badexample.com/'));
  assert.ok(!ruleMatches(rules[0], 'chrome://example.com/'));
  assert.ok(!ruleMatches(rules[1], 'https://example.com/docsx'));
  assert.ok(!ruleMatches(rules[2], 'https://other.org/'), 'disabled rules never match');
  const a = matchRules(rules, 'https://example.com/docs/page');
  assert.equal(a.zoom, 0.9);
  assert.equal(a.forceDark, true);
  assert.deepEqual(a.matched, ['r1', 'r2']);
  assert.ok(cssFor(a).includes(DARK_MODE_CSS) && cssFor(a).includes('font-size:18px'));
  const b = matchRules(rules, 'https://example.com/blog');
  assert.equal(b.zoom, 1.25);
  assert.equal(b.forceDark, false);
  assert.equal(cssFor(matchRules(rules, 'https://none.net/')), '');
});

test('site rules: quick dark toggle and parsing', () => {
  let r = toggleDarkForHost([], 'news.net', 'n1');
  assert.equal(r.dark, true);
  assert.equal(r.rules.length, 1);
  r = toggleDarkForHost(r.rules, 'news.net', 'n2');
  assert.equal(r.dark, false);
  assert.equal(r.rules.length, 1);
  const parsed = parseRules([{ pattern: 'HTTPS://A.com/', zoom: 99 }, { pattern: '' }, 'junk']);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].pattern, 'a.com');
  assert.equal(parsed[0].zoom, 5);
  assert.equal(parsed[0].enabled, true);
});

const defs: WidgetSizeDef[] = [
  { type: 'clock', defaultW: 4, defaultH: 2, minW: 2, minH: 2 },
  { type: 'links', defaultW: 8, defaultH: 3, minW: 3, minH: 2, maxH: 6 },
];
const noOverlap = (l: Layout) => l.every((a) => l.every((b) => !collides(a, b)));

test('layout: add finds free spots, move pushes and compacts', () => {
  let l: Layout = [];
  l = addWidget(l, 'clock', defs, 'c1');
  l = addWidget(l, 'links', defs, 'l1');
  l = addWidget(l, 'clock', defs, 'c2');
  assert.deepEqual(l.map((p) => [p.x, p.y]), [[0, 0], [4, 0], [0, 2]]);
  l = moveWidget(l, 'c2', 4, 0, defs);
  assert.ok(noOverlap(l));
  assert.deepEqual(l.find((p) => p.id === 'c2')!.y, 0);
  assert.ok(l.find((p) => p.id === 'l1')!.y >= 2);
  l = resizeWidget(l, 'l1', 99, 99, defs);
  const l1 = l.find((p) => p.id === 'l1')!;
  assert.equal(l1.w, 12);
  assert.equal(l1.h, 6);
  assert.ok(noOverlap(l));
  assert.throws(() => addWidget(l, 'nope', defs, 'x'));
});

test('layout: persistence round trip is stable and validates input', () => {
  let l: Layout = addWidget(addWidget([], 'clock', defs, 'c1'), 'links', defs, 'l1');
  l = updateWidgetSettings(l, 'c1', { hour24: true });
  const stored = JSON.parse(JSON.stringify(l));
  assert.deepEqual(parseLayout(stored, defs), l);
  const messy = parseLayout(
    [
      { id: 'a', type: 'clock', x: -3, y: 9, w: 1, h: 1 },
      { id: 'a', type: 'clock', x: 0, y: 0, w: 4, h: 2 },
      { id: 'b', type: 'unknown', x: 0, y: 0, w: 4, h: 2 },
      { id: 'c', type: 'links', x: 11, y: 0, w: 8, h: 3 },
    ],
    defs
  )!;
  assert.equal(messy.length, 2);
  assert.deepEqual([messy[0].x, messy[0].y, messy[0].w, messy[0].h], [0, 0, 2, 2]);
  assert.deepEqual([messy[1].x, messy[1].w], [4, 8]);
  assert.ok(noOverlap(messy));
  assert.equal(parseLayout('x', defs), null);
  assert.equal(removeWidget(messy, 'a').length, 1);
});

test('markdown: escapes HTML and renders basics', () => {
  const html = renderMarkdown('# Hi\n**b** <script>x</script>\n- [x] done\n[l](javascript:alert(1)) [ok](https://a.com)');
  assert.ok(html.includes('<h1>Hi</h1>'));
  assert.ok(html.includes('<strong>b</strong>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('href="https://a.com"'));
});

test('search ranking prefers prefix/word matches', () => {
  const r = rank([{ title: 'Something else', url: 'https://x.com' }, { title: 'GitHub', url: 'https://github.com' }], 'git');
  assert.equal(r[0].title, 'GitHub');
  assert.equal(r.length, 1);
});

test('i18n: locale resolution and complete Turkish dictionary', () => {
  assert.equal(resolveLocale('auto', 'tr-TR'), 'tr');
  assert.equal(resolveLocale(undefined, 'de-DE'), 'en');
  assert.equal(resolveLocale('en', 'tr'), 'en');
  assert.deepEqual(missingKeys('tr'), []);
  assert.equal(translate('tr', 'ws.tabs', { n: 3 }), '3 sekme');
});

test('feature module manifests validate and default config is derived', () => {
  for (const m of FEATURE_MANIFESTS) {
    const res = validateManifest(m, '0.2.0');
    assert.ok(res.valid, `${m.id}: ${JSON.stringify(res.errors)}`);
  }
  assert.equal(isModuleEnabled(null, 'tab-suspender', true), true);
  const bundle = { version: 1, global: {}, enabledModuleIds: [], disabledModuleIds: ['tab-suspender'], modules: { 'tab-suspender': { idleMinutes: 5 } } } as never;
  assert.equal(isModuleEnabled(bundle, 'tab-suspender', true), false);
  const c = moduleConfig<SuspenderConfig>(bundle, 'tab-suspender', suspenderManifest.configSchema!);
  assert.equal(c.idleMinutes, 5);
  assert.equal(c.excludePinned, true);
});
