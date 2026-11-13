#!/usr/bin/env node
// Copies Helium's new-tab shortcuts (custom links) into an Oxygen import file.
// Reads a *copy* of the profile's Preferences; the profile itself is never written.
//
//   node scripts/import_shortcuts.mjs [--profile DIR] [--preferences FILE] [--out FILE] [--dist DIR]
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logic = join(root, 'oxygen-core/dist/extension/src/logic/shortcuts.js');
if (!existsSync(logic)) {
  console.error('oxygen-core is not built; run ./scripts/oxygen.sh build first');
  process.exit(1);
}
const { makeImportFile } = await import(logic);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const data = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
const profile = opt('--profile', join(config, 'net.imput.helium/Default'));
const prefsPath = opt('--preferences', join(profile, 'Preferences'));
const out = opt('--out', join(data, 'oxygen/imported-shortcuts.json'));
const dist = opt('--dist', join(root, 'dist/extension'));

const tmp = mkdtempSync(join(tmpdir(), 'oxygen-prefs-'));
let prefs;
try {
  const copy = join(tmp, 'Preferences');
  copyFileSync(prefsPath, copy); // Helium may rewrite the file at any time; parse a snapshot
  prefs = JSON.parse(readFileSync(copy, 'utf8'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const file = makeImportFile(prefs);
const json = JSON.stringify(file, null, 2) + '\n';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, json, { mode: 0o600 });
chmodSync(out, 0o600);
if (existsSync(join(dist, 'manifest.json'))) writeFileSync(join(dist, 'imported-shortcuts.json'), json, { mode: 0o600 });

// Titles only: URLs can carry secrets (e.g. share-link keys in the fragment).
console.log(`${file.shortcuts.length} shortcut(s) from ${prefsPath}:`);
file.shortcuts.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
console.log(`-> ${out}${existsSync(join(dist, 'manifest.json')) ? ` and ${join(dist, 'imported-shortcuts.json')}` : ''}`);
