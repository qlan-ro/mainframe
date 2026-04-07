import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import type { Plugin } from 'vite';

const daemonHost = process.env['VITE_DAEMON_HOST'] ?? '127.0.0.1';
const daemonPort = process.env['VITE_DAEMON_HTTP_PORT'] ?? '31415';

/** Rewrite the CSP meta tag so the renderer can reach the daemon at the configured port. */
function dynamicCspPlugin(): Plugin {
  return {
    name: 'dynamic-csp',
    transformIndexHtml(html) {
      return html.replace(
        /connect-src\s+'self'[^"']*/,
        `connect-src 'self' http://${daemonHost}:${daemonPort} ws://${daemonHost}:${daemonPort}`,
      );
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        external: ['electron', 'node-pty'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {},
    plugins: [react(), tailwindcss(), dynamicCspPlugin()],
  },
});
