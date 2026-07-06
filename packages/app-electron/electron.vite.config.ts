// The renderer is now supplied by packages/app-tauri (its own Vite build).
// This config only builds the Electron main process and preload script.
//
// Dev workflow:
//   1. pnpm --filter @qlan-ro/mainframe-app-tauri dev   (starts on :5174, strictPort)
//   2. pnpm --filter @qlan-ro/mainframe-app-electron dev     (Electron shell loads http://localhost:5174)
//
// Prod workflow:
//   1. pnpm --filter @qlan-ro/mainframe-app-tauri build (produces packages/app-tauri/dist)
//   2. pnpm --filter @qlan-ro/mainframe-app-electron build   (electron-vite build + daemon bundle)
//   3. pnpm --filter @qlan-ro/mainframe-app-electron package (electron-builder copies app-tauri/dist
//      to extraResources/app-tauri-renderer via the electron-builder config in package.json)

import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron', 'node-pty'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
        external: ['electron'],
      },
    },
  },
});
