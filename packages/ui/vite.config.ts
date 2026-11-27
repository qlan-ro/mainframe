import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import type { Plugin } from 'vite';

/**
 * Streamdown statically imports rehype-raw (with parse5), rehype-sanitize and
 * rehype-harden for its default `rehypePlugins`. Mainframe passes none (raw HTML
 * renders as text), so they never run; in a build they resolve to stubs, which
 * keeps about 50 KB gzip out of the entry chunk. Only imports made from inside
 * the streamdown package are stubbed: anything else importing them gets the real
 * module. `src/__tests__/streamdown-pin.test.ts` fails when Streamdown's version
 * changes, to re-verify this. Tests and the dev server use the real modules.
 */
const STREAMDOWN_UNUSED = new Set(['rehype-raw', 'rehype-sanitize', 'rehype-harden']);
const STREAMDOWN_STUB = resolve(__dirname, './build-stubs/streamdown-unused.js');
const streamdownImporter = /[\\/]node_modules[\\/]streamdown[\\/]/;

function stubStreamdownHtmlPlugins(): Plugin {
  return {
    name: 'mainframe:stub-streamdown-html-plugins',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !STREAMDOWN_UNUSED.has(source) || !streamdownImporter.test(importer)) return null;
      return STREAMDOWN_STUB;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: './',
  // React Compiler (infer mode) memoizes every component and hook it can prove
  // safe; opt one out with a `'use no memo'` directive plus a one-line reason.
  plugins: [stubStreamdownHtmlPlugins(), tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    // Honour VITE_PORT from the launch/run config; default to 5174 so Tauri's
    // fixed devUrl still matches when it's unset (e.g. `tauri dev`).
    port: Number(process.env.VITE_PORT) || 5174,
    // Tauri expects a fixed port; fail if it's not available
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  // Env variables starting with the item of `envPrefix` will be exposed in tauri's source code through `import.meta.env`.
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2020',
    // Don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? ('oxc' as const) : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
