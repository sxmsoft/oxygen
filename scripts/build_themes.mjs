#!/usr/bin/env node
// Generates the three Oxygen theme packs (theme-only MV3 extensions, no scripts)
// from the Obsidian module palettes. Requires `npm run build` in oxygen-core first.
//
// Usage: node scripts/build_themes.mjs [outDir=dist/themes]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = resolve(repo, process.argv[2] ?? 'dist/themes');
const { resolveObsidianTokens, obsidianThemeManifest } = await import(
  resolve(repo, 'oxygen-core/dist/modules/core-theme-obsidian/src/index.js')
);
const publicKeys = JSON.parse(readFileSync(resolve(repo, 'themes/public-keys.json'), 'utf8'));
const version = JSON.parse(readFileSync(resolve(repo, 'extension/public/manifest.json'), 'utf8')).version;

const VARIANTS = ['obsidian', 'graphite', 'midnight'];
const defaults = Object.fromEntries(
  Object.entries(obsidianThemeManifest.configSchema).map(([k, f]) => [k, f.default])
);

/** '#RRGGBB' or '#RRGGBBAA' -> [r, g, b] or [r, g, b, a(0..1)] */
function rgb(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (h.length === 8) c.push(Number((parseInt(h.slice(6, 8), 16) / 255).toFixed(2)));
  return c;
}

const title = (v) => v[0].toUpperCase() + v.slice(1);

rmSync(outRoot, { recursive: true, force: true });
for (const variant of VARIANTS) {
  const t = resolveObsidianTokens({ ...defaults, surfaceContrast: variant });
  // Mapping mirrors the fork's OxygenThemeColorMixer (oxygen_color_mixer.cc, tag v0.1-fork).
  const colors = {
    frame: rgb(t.surfacePrimary),
    frame_inactive: rgb(t.surfacePrimary),
    frame_incognito: rgb(t.surfacePrimary),
    frame_incognito_inactive: rgb(t.surfacePrimary),
    background_tab: rgb(t.surfacePrimary),
    background_tab_inactive: rgb(t.surfacePrimary),
    toolbar: rgb(t.surfaceToolbar),
    toolbar_text: rgb(t.textPrimary),
    toolbar_button_icon: rgb(t.accentColor),
    tab_text: rgb(t.textPrimary),
    tab_background_text: rgb(t.textMuted),
    tab_background_text_inactive: rgb(t.textMuted),
    bookmark_text: rgb(t.textPrimary),
    omnibox_background: rgb(t.surfaceElevated),
    omnibox_text: rgb(t.textPrimary),
    ntp_background: rgb(t.surfacePrimary),
    ntp_text: rgb(t.textPrimary),
    ntp_link: rgb(t.accentColor),
  };
  const dir = resolve(outRoot, variant);
  mkdirSync(resolve(dir, 'icons'), { recursive: true });
  for (const size of [16, 48, 128]) {
    copyFileSync(
      resolve(repo, `resources/generated/product_icon/${size}x${size}.png`),
      resolve(dir, `icons/${size}.png`)
    );
  }
  const manifest = {
    manifest_version: 3,
    name: `Oxygen Theme ${title(variant)}`,
    version,
    description: `Oxygen ${title(variant)} browser theme for Helium (managed by the Oxygen extension).`,
    key: publicKeys[variant],
    icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    theme: { colors },
  };
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`theme ${variant}: ${dir}`);
}
