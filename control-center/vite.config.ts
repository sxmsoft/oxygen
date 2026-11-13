import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');

/** Copies Oxygen branding icons into the extension bundle (icons/<size>.png). */
function oxygenIcons(): Plugin {
  return {
    name: 'oxygen-extension-icons',
    generateBundle() {
      for (const size of [16, 32, 48, 128]) {
        this.emitFile({
          type: 'asset',
          fileName: `icons/${size}.png`,
          source: readFileSync(
            resolve(repo, `resources/generated/product_icon/${size}x${size}.png`)
          ),
        });
      }
    },
  };
}

// `vite build`                  -> standalone preview in control-center/dist
// `vite build --mode extension` -> MV3 extension in dist/extension (page + service worker)
export default defineConfig(({ mode }) => {
  const extension = mode === 'extension';
  return {
    plugins: [svelte(), ...(extension ? [oxygenIcons()] : [])],
    base: './',
    publicDir: extension ? resolve(repo, 'extension/public') : false,
    build: {
      outDir: extension ? resolve(repo, 'dist/extension') : 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
      modulePreload: extension ? { polyfill: false } : undefined,
      rollupOptions: {
        input: extension
          ? {
              index: resolve(here, 'index.html'),
              background: resolve(repo, 'extension/src/background.ts'),
            }
          : resolve(here, 'index.html'),
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/control-center.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  };
});
