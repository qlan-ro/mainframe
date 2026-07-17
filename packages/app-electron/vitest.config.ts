import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    env: { NODE_ENV: 'development' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/__tests__/playwright/**', 'node_modules/**', 'dist/**'],
    // Every remaining test targets main-process node code; a future DOM test
    // can opt in with a `// @vitest-environment jsdom` pragma.
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/__tests__/**'],
    },
  },
});
