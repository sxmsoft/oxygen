import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shortcutsFromPreferences, makeImportFile, parseImportFile, mergeShortcuts, fingerprint, urlKey,
  barItems, bookmarkRoots, ALL_BOOKMARKS_ID, type BookmarkNodeLike, type QuickLinkLike,
} from '../../extension/src/logic/shortcuts.js';

const prefs = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/helium-Preferences.json', import.meta.url), 'utf8'));

test('custom links keep Helium order and titles; invalid and duplicate entries are dropped', () => {
  const s = shortcutsFromPreferences(prefs);
  assert.deepEqual(s.map((x) => x.title), ['Video', 'Çalışma Alanı', 'Gizli Klasör', 'untitled.example', 'Long Title For A Banner Tool']);
  assert.equal(s[2].url, 'https://files.example/folder/abc#key-XYZ', 'url (incl. fragment) is kept byte-identical');
  assert.equal(s[0].url, 'https://video.example/');
});

test('preferences without custom links give an empty list', () => {
  assert.deepEqual(shortcutsFromPreferences({}), []);
  assert.deepEqual(shortcutsFromPreferences(null), []);
  assert.deepEqual(shortcutsFromPreferences({ custom_links: { list: 'x' } }), []);
});

test('import file round-trips and rejects junk', () => {
  const f = makeImportFile(prefs, new Date('2026-01-02T03:04:05Z'));
  assert.equal(f.generatedAt, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(parseImportFile(JSON.parse(JSON.stringify(f)))?.shortcuts, f.shortcuts);
  assert.equal(parseImportFile({ version: 2, shortcuts: [] }), null);
  assert.equal(parseImportFile({ version: 1, shortcuts: [{ title: 'x', url: 'javascript:1' }] })?.shortcuts.length, 0);
});

test('merge puts the import first, keeps user links, replaces a previous import and is idempotent', () => {
  const imported = shortcutsFromPreferences(prefs);
  const user: QuickLinkLike[] = [
    { id: 'u1', title: 'Mine', url: 'https://mine.example/' },
    { id: 'u2', title: 'My video', url: 'https://video.example' },
    { id: 'old', title: 'Removed in Helium', url: 'https://gone.example/', source: 'helium' },
  ];
  const merged = mergeShortcuts(user, imported);
  assert.deepEqual(merged.map((l) => l.title), [...imported.map((s) => s.title), 'Mine']);
  assert.deepEqual(mergeShortcuts(merged, imported), merged, 'applying twice changes nothing');
  assert.equal(new Set(merged.map((l) => l.id)).size, merged.length, 'ids are unique');
});

test('fingerprint changes with order or titles; urlKey ignores case/www/trailing slash only', () => {
  const a = [{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }];
  assert.notEqual(fingerprint(a), fingerprint([...a].reverse()));
  assert.notEqual(fingerprint(a), fingerprint([{ ...a[0], title: 'a' }, a[1]]));
  assert.equal(urlKey('https://WWW.Example.com/x/'), urlKey('https://example.com/x'));
  assert.notEqual(urlKey('https://example.com/x?a=1'), urlKey('https://example.com/x'));
});

const tree: BookmarkNodeLike[] = [{
  id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [
      { id: '10', title: 'News', url: 'https://news.example/' },
      { id: '11', title: 'Dev', children: [{ id: '12', title: 'Docs', url: 'https://docs.example/' }] },
    ] },
    { id: '2', title: 'Other bookmarks', folderType: 'other', children: [{ id: '20', title: 'PS5', url: 'https://ps.example/' }] },
    { id: '3', title: 'Mobile bookmarks', folderType: 'mobile', children: [] },
  ],
}];

test('bookmarks bar mirrors the bar in order plus an All bookmarks folder', () => {
  const items = barItems(tree);
  assert.deepEqual(items.map((i) => i.id), ['10', '11', ALL_BOOKMARKS_ID]);
  assert.deepEqual(items[2].children?.map((c) => c.id), ['20'], 'empty mobile folder is hidden');
  assert.deepEqual(barItems(tree, false).map((i) => i.id), ['10', '11']);
  const noFolderType = JSON.parse(JSON.stringify(tree).replace(/"folderType":"[a-z-]+",?/g, ''));
  assert.equal(bookmarkRoots(noFolderType).bar?.id, '1');
  assert.deepEqual(barItems([{ id: '0', title: '', children: [] }]), []);
});
