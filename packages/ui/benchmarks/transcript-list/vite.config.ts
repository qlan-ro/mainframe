/**
 * Builds the rig as a production bundle. Two imports inside the real transcript
 * are redirected so the variants can swap the list around the same rows:
 * `thread/VirtualMessages` (from `TurnTranscript`) and `messages/turn/use-row-anchor`.
 * Nothing in `src/` changes.
 */
import { defineConfig, type Plugin } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const src = resolve(import.meta.dirname, '../../src');
const here = import.meta.dirname;
const REDIRECTS: Record<string, string> = {
  [resolve(src, 'features/chat/thread/VirtualMessages.tsx')]: resolve(here, 'lists/list-switch.tsx'),
  [resolve(src, 'features/chat/messages/turn/use-row-anchor.ts')]: resolve(here, 'lists/row-anchor-switch.ts'),
};

function redirectList(): Plugin {
  return {
    name: 'rig-redirect-list',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(here)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && REDIRECTS[resolved.id] ? REDIRECTS[resolved.id] : null;
    },
  };
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [redirectList(), tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  // The profiling build of react-dom, so `<Profiler>` reports each commit's render time (P6).
  // `RIG_PROFILE=0` builds with plain react-dom, for mount times comparable with the app.
  resolve: {
    alias: [
      ...(process.env.RIG_PROFILE === '0' ? [] : [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }]),
      { find: '@', replacement: src },
    ],
  },
  build: {
    target: 'es2022',
    outDir: process.env.RIG_OUT ?? resolve(here, '../../node_modules/.rig-transcript-list'),
    emptyOutDir: true,
  },
  logLevel: 'warn',
});
