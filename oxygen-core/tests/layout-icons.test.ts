import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWidget, moveWidget, parseLayout, rescaleLayout, collides, type WidgetSizeDef } from '../../extension/src/logic/layout.js';
import { parseGrid, effectiveRowHeight, frameOf, PRESETS, presetById, DEFAULT_GRID } from '../../extension/src/logic/gridConfig.js';
import { colorFor, letterFor, parseIcon, moveLink, updateLink, iconCandidates } from '../../extension/src/logic/linkIcons.js';

const defs: WidgetSizeDef[] = [
  { type: 'links', defaultW: 8, defaultH: 2, minW: 3, minH: 2, maxH: 6 },
  { type: 'clock', defaultW: 4, defaultH: 2, minW: 2, minH: 2, maxH: 4 },
  { type: 'search', defaultW: 8, defaultH: 1, minW: 4, minH: 1, maxH: 1 },
  { type: 'bookmarks', defaultW: 12, defaultH: 2, minW: 4, minH: 1, maxH: 8 },
  { type: 'weather', defaultW: 4, defaultH: 2, minW: 3, minH: 2, maxH: 4 },
  { type: 'workspaces', defaultW: 4, defaultH: 3, minW: 3, minH: 2, maxH: 8 },
  { type: 'recent', defaultW: 4, defaultH: 3, minW: 3, minH: 2, maxH: 8 },
];

test('layout engine works with any column count', () => {
  const l24 = addWidget([], 'links', defs, 'a', {}, 24);
  assert.equal(l24[0].w, 16, 'default width scales from 12 to 24 columns');
  const moved = moveWidget(l24, 'a', 30, 0, defs, 24);
  assert.equal(moved[0].x, 8, 'clamped to the 24-column edge');
  const p = parseLayout([{ id: 'a', type: 'links', x: 5, y: 0, w: 8, h: 2 }], defs, 6);
  assert.deepEqual([p![0].x, p![0].w], [0, 6]);
});

test('rescaling keeps relative positions and never overlaps', () => {
  const l = PRESETS[0].layout('');
  const r = rescaleLayout(l, 12, 6, defs);
  assert.equal(r.find((w) => w.id === 'w-clock')!.x, 4);
  for (const a of r) for (const b of r) assert.ok(!collides(a, b), `${a.id} overlaps ${b.id}`);
  assert.deepEqual(rescaleLayout(l, 12, 12, defs), l);
});

test('grid config is clamped, defaults kept, legacy row height honored', () => {
  assert.deepEqual(parseGrid(null), DEFAULT_GRID);
  assert.equal(parseGrid(null, 100).rowHeight, 100);
  const g = parseGrid({ columns: 99, gap: -5, maxWidth: 0, align: 'weird', frames: 'none', rowMode: 'fit', rows: 6 });
  assert.deepEqual([g.columns, g.gap, g.maxWidth, g.align, g.frames], [24, 0, 0, 'center', 'none']);
  assert.equal(effectiveRowHeight(g, 900, 100), Math.floor((900 - 100 - 32) / 6));
  assert.equal(effectiveRowHeight({ ...g, rowMode: 'fixed', rowHeight: 70 }, 900, 100), 70);
  assert.equal(frameOf({ frame: 'glass' }, g), 'glass');
  assert.equal(frameOf({}, g), 'none');
});

test('presets are valid layouts', () => {
  for (const p of PRESETS) {
    const l = p.layout('İstanbul');
    const parsed = parseLayout(l, defs)!;
    assert.equal(parsed.length, l.length, p.id);
    for (const a of parsed) for (const b of parsed) assert.ok(!collides(a, b), `${p.id}: ${a.id}/${b.id}`);
    assert.ok(parsed.some((w) => w.type === 'links'), `${p.id} has quick links`);
  }
  assert.equal(presetById('helium')?.grid.frames, 'none');
});

test('link icons: letters, stable colors, validation', () => {
  assert.equal(letterFor('Youtube', 'https://youtube.com'), 'Y');
  assert.equal(letterFor('', 'https://www.gemini.google.com/app'), 'G');
  assert.equal(letterFor('★ Top Secret', 'https://x.example'), 'T');
  assert.equal(colorFor('https://a.example/x'), colorFor('https://www.a.example/y'));
  assert.deepEqual(parseIcon({ kind: 'emoji', text: '🎮', bg: '#112233' }), { kind: 'emoji', text: '🎮', bg: '#112233' });
  assert.deepEqual(parseIcon({ kind: 'letter', text: 'ABC', bg: 'red' }), { kind: 'letter', text: 'AB', bg: '#5e81ac' });
  assert.deepEqual(parseIcon({ kind: 'image', id: '' }), { kind: 'auto' });
  assert.deepEqual(parseIcon(undefined), { kind: 'auto' });
});

test('reorder and edit links', () => {
  const l = [{ id: 'a', title: 'A', url: 'u' }, { id: 'b', title: 'B', url: 'u' }, { id: 'c', title: 'C', url: 'u' }];
  assert.deepEqual(moveLink(l, 'c', 'a').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(moveLink(l, 'a', null).map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(moveLink(l, 'zz', 'a'), l);
  assert.equal(updateLink(l, 'b', { title: 'Bee' })[1].title, 'Bee');
});

test('high-res icon candidates come largest first', () => {
  const html = `<link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel="apple-touch-icon" href="/apple-180.png">
    <link rel=icon href=https://cdn.example/logo-192.png sizes="192x192"><link rel="mask-icon" href="/mask.svg"><link rel="icon" href="/logo.svg" type="image/svg+xml">`;
  assert.deepEqual(iconCandidates(html, 'https://site.example/app'), [
    'https://site.example/logo.svg',
    'https://cdn.example/logo-192.png',
    'https://site.example/apple-180.png',
    'https://site.example/apple-touch-icon.png',
  ]);
});

import { mergeShortcuts } from '../../extension/src/logic/shortcuts.js';
test('re-import keeps a custom icon chosen for an imported shortcut', () => {
  const icon = { kind: 'emoji', text: '🎮', bg: '#112233' };
  const before = mergeShortcuts([], [{ title: 'A', url: 'https://a.example/' }]);
  const edited = [{ ...before[0], icon }];
  const after = mergeShortcuts(edited, [{ title: 'A2', url: 'https://a.example/' }]);
  assert.deepEqual([after.length, after[0].title, after[0].icon], [1, 'A2', icon]);
});
