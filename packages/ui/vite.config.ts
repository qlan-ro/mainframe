import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  // React Compiler (infer mode) memoizes every component and hook it can prove
  // safe; opt one out with a `'use no memo'` directive plus a one-line reason.
  plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      // Streamdown imports these for its default rehype plugins, which we replace
      // with none (raw HTML renders as text). Not applied to tests, so they see
      // the real modules.
      ...(mode === 'production'
        ? [/^rehype-raw$/, /^rehype-sanitize$/, /^rehype-harden$/].map((find) => ({
            find,
            replacement: resolve(__dirname, './build-stubs/streamdown-unused.js'),
          }))
        : []),
    ],
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
