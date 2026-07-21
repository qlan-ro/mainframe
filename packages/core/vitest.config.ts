import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
