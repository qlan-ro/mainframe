import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

const daemonHost = process.env['VITE_DAEMON_HOST'] ?? '127.0.0.1';
const daemonPort = process.env['VITE_DAEMON_HTTP_PORT'] ?? '31415';

/** Rewrite the CSP meta tag so the sandbox app can reach its own daemon. */
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
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss(), dynamicCspPlugin()],
  server: {
    host: '127.0.0.1',
    port: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 5173,
  },
});
