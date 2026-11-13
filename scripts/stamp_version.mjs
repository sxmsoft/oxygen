#!/usr/bin/env node
// Gives every build with different code its own manifest version (0.2.0 -> 0.2.0.N).
//
// Chromium keeps an extension's service worker scripts in the profile's
// Service Worker storage and only re-registers them when the manifest version
// changes; an unpacked/--load-extension build with an unchanged version keeps
// running the old service worker after a restart. N increases only when the
// built files (minus manifest and the personal shortcut import) change.
//
//   node scripts/stamp_version.mjs <dist/extension> [state-file]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2];
const stateFile = process.argv[3] ?? join(dir, '..', '.build-state.json');
const SKIP = new Set(['manifest.json', 'imported-shortcuts.json']);

function* files(d) {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (!SKIP.has(relative(dir, p))) yield p;
  }
}
const h = createHash('sha256');
for (const f of files(dir)) h.update(relative(dir, f)).update('\0').update(readFileSync(f)).update('\0');
const manifestPath = join(dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const base = String(manifest.version).split('.').slice(0, 3).join('.');
h.update(base);
const hash = h.digest('hex');

const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { build: 0, hash: '' };
if (state.hash !== hash || state.base !== base) {
  state.build = Math.min(65535, (state.build ?? 0) + 1);
  state.hash = hash;
  state.base = base;
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}
manifest.version = `${base}.${state.build}`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
// Bake the version into the code (extension/src/build.ts) after hashing.
let stamped = 0;
for (const f of files(dir)) {
  if (!f.endsWith('.js')) continue;
  const src = readFileSync(f, 'utf8');
  if (src.includes('__OXYGEN_BUILD__')) {
    writeFileSync(f, src.replaceAll('__OXYGEN_BUILD__', manifest.version));
    stamped++;
  }
}
if (!stamped) throw new Error('no __OXYGEN_BUILD__ placeholder found in the build');
console.log(`==> manifest version ${manifest.version}${manifest.version_name ? ` (${manifest.version_name})` : ''}`);
