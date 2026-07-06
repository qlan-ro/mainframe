import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    env: { NODE_ENV: 'development' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'src-tauri/**'],
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      // Floor just below the current level — a regression gate, not an aspirational
      // target. Raise as UI shells (App, surfaces, lib/tauri bridge) get covered.
      thresholds: { lines: 45, branches: 48, functions: 35, statements: 43 },
    },
  },
});
