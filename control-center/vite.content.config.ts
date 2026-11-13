import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');

// Injected-on-demand palette script: one self-contained IIFE (content scripts can't be ES modules).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(repo, 'dist/extension/content'),
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      input: resolve(repo, 'extension/src/content/palette.ts'),
      output: { format: 'iife', entryFileNames: 'palette.js', inlineDynamicImports: true },
    },
  },
});
