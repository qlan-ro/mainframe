import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Longest prefix first: Vite matches aliases in order, so a bare '@'
      // would swallow '@v2/...' before the specific entry is ever tried.
      '@v2': resolve(__dirname, './src/v2'),
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    env: { NODE_ENV: 'development' },
    exclude: ['node_modules/**', 'dist/**', 'src-tauri/**'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
    },
    // jsdom startup dominates suite time, so only component tests (.test.tsx)
    // get it; logic tests (.test.ts) run in node. A DOM-touching .test.ts
    // opts back in with a `// @vitest-environment jsdom` pragma.
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
