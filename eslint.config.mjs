import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Rules of Hooks plus the React Compiler diagnostics.
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      // Pre-existing findings, kept visible as warnings rather than cleared by
      // a sweeping rewrite. The compiler skips a function that breaks refs,
      // immutability, globals or preserve-manual-memoization (no miscompile);
      // set-state-in-effect is a render-cost hint, and static-components fires
      // on registry lookups (`resolveToolCard`, `tokenIcon`) that are stable.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  {
    // `purity` stays an error everywhere else: the build compiler does not
    // check it, and a render-time `Date.now()` gets cached (use `useNow`).
    // These two read it inside a useMemo whose compiled key matches the
    // manual deps; another branch is rewriting both files.
    files: [
      'packages/ui/src/features/sessions/SessionSidebar.tsx',
      'packages/ui/src/features/chat/messages/compact/CompactTranscript.tsx',
    ],
    rules: { 'react-hooks/purity': 'warn' },
  },
  { ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/resources/daemon.cjs'] },
  eslintConfigPrettier,
);
