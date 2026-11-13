import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collides, moveWidget, resizeWidget, type Layout, type WidgetSizeDef } from '../../extension/src/logic/layout.js';

// The layout from a real profile where dragging the clock froze the new tab
// (placeAndPush looped forever for 132 of 1248 drop positions).
const REAL: Layout = [
  { h: 1, id: 'w-search', settings: {}, type: 'search', w: 8, x: 0, y: 0 },
  { h: 2, id: 'w-links', settings: {}, type: 'links', w: 8, x: 0, y: 1 },
  { h: 2, id: 'w-bookmarks', settings: {}, type: 'bookmarks', w: 8, x: 0, y: 3 },
  { h: 2, id: 'w-weather', settings: {}, type: 'weather', w: 4, x: 4, y: 5 },
  { h: 3, id: 'w-recent', settings: {}, type: 'recent', w: 4, x: 0, y: 5 },
  { h: 2, id: 'w-clock-1', settings: {}, type: 'clock', w: 4, x: 8, y: 0 },
];
const defs: WidgetSizeDef[] = [
  { type: 'clock', defaultW: 4, defaultH: 2, minW: 2, minH: 2, maxH: 4 },
  { type: 'weather', defaultW: 4, defaultH: 2, minW: 3, minH: 2, maxH: 4 },
  { type: 'search', defaultW: 8, defaultH: 1, minW: 4, minH: 1, maxH: 1 },
  { type: 'links', defaultW: 8, defaultH: 2, minW: 2, minH: 1, maxH: 8 },
  { type: 'bookmarks', defaultW: 12, defaultH: 2, minW: 4, minH: 1, maxH: 8 },
  { type: 'recent', defaultW: 4, defaultH: 3, minW: 3, minH: 2, maxH: 8 },
];
const noOverlap = (l: Layout) => l.every((a) => l.every((b) => !collides(a, b)));

test('every drop position terminates quickly without overlaps (real layout)', () => {
  let worst = 0;
  for (const cols of [12, 24])
    for (const w of REAL)
      for (let x = -2; x <= cols + 1; x++)
        for (let y = 0; y <= 12; y++) {
          const t = performance.now();
          const m = moveWidget(REAL, w.id, x, y, defs, cols);
          const r = resizeWidget(REAL, w.id, x, y + 1, defs, cols);
          worst = Math.max(worst, performance.now() - t);
          assert.ok(noOverlap(m) && noOverlap(r), `${w.id} -> ${x},${y}`);
          assert.equal(m.length, REAL.length);
        }
  assert.ok(worst < 20, `slowest move ${worst.toFixed(2)} ms`);
});

test('a drag path (many successive moves) stays bounded', () => {
  let l = REAL;
  for (let i = 0; i < 400; i++) l = moveWidget(l, 'w-clock-1', (i * 7) % 13, (i * 5) % 9, defs);
  assert.ok(noOverlap(l));
  assert.ok(Math.max(...l.map((w) => w.y + w.h)) <= 14);
});
