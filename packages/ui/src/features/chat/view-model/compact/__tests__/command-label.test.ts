import { expect, it } from 'vitest';
import { commandLabel } from '../command-label';
import { tool } from './fixtures';

it.each([
  ['cat "src/a b.ts"', 'Read src/a b.ts'],
  ['head -n 10 src/a.ts', 'Read src/a.ts'],
  ["sed -n '1,80p' src/a.ts", 'Read src/a.ts'],
  ['rg -n "hello world" src', 'Searched for "hello world" in src'],
  ['grep -ri needle src', 'Searched for "needle" in src'],
  ['ls -la src', 'Listed src'],
  ['rg --files src', 'Listed src'],
  ['npm test', 'Tests passed'],
  ['pnpm run lint', 'Lint passed'],
  ['yarn typecheck', 'Typecheck passed'],
  ['bun run build', 'Build passed'],
  ['npm run format', 'Formatted code'],
  ['pnpm install --frozen-lockfile', 'Installed dependencies'],
  ['git status --short', 'Checked Git status'],
  ['git diff --stat', 'Viewed Git diff'],
  ['git log -n 5', 'Viewed Git history'],
  ['git add src/a.ts', 'Staged changes'],
  ['git commit -m "fix thing"', 'Committed changes'],
  ['git push origin branch', 'Pushed changes'],
  ['git pull --rebase', 'Pulled changes'],
  ['git fetch origin', 'Fetched changes'],
  ['git switch feature', 'Switched branches'],
  ['CI=1 pnpm test', 'Tests passed'],
  ['env -i -u DEBUG CI=1 pnpm test', 'Tests passed'],
  ['sudo -n -u builder -- pnpm run build', 'Build passed'],
  ["bash -lc 'pnpm test'", 'Tests passed'],
  ['zsh --norc -l -c "env CI=1 npm run lint"', 'Lint passed'],
  ['/usr/bin/cat src/a.ts', 'Read src/a.ts'],
])('labels the complete command %s', (command, expected) => {
  expect(commandLabel(tool({ toolName: 'Bash', args: { command } }), 'success')).toBe(expected);
});

it.each([
  'pnpm test && rm -rf build',
  'cat a | grep x',
  'cat a; echo b',
  'cat $(pwd)/a',
  'cat `pwd`/a',
  'if true; then cat a; fi',
  'cat <<EOF',
  'cat a > b',
  'pnpm test\necho done',
  'cat "$FILE"',
  'env --unknown pnpm test',
  'sudo -Z pnpm test',
  "bash -c 'pnpm test' extra",
  'pnpm --unknown test',
  'ls --unknown src',
  'rg --unknown needle src',
  'cat --unknown a',
  'git --unknown status',
  'npm test -- --unknown',
  'npm run test:surprise',
  'cat "unterminated',
])('falls back for ambiguous syntax/options: %s', (command) => {
  expect(commandLabel(tool({ args: { command, description: 'Provider description' } }), 'success')).toBe(
    'Provider description',
  );
});

it('prefers structured actions over command parsing and description', () => {
  const part = tool({
    args: { command: 'npm test', description: 'Other description' },
    providerMetadata: { codex: { commandActions: [{ type: 'read', command: 'cat a', name: 'a', path: 'a' }] } },
  });
  expect(commandLabel(part, 'success')).toBe('Read a');
});

it('falls back from mixed structured actions as a whole', () => {
  const part = tool({
    args: { command: 'npm test' },
    providerMetadata: {
      codex: {
        commandActions: [
          { type: 'read', command: 'cat a', name: 'a', path: 'a' },
          { type: 'unknown', command: 'echo b' },
        ],
      },
    },
  });
  expect(commandLabel(part, 'success')).toBe('Tests passed');
});

it.each([
  ['running', 'Running tests'],
  ['success', 'Tests passed'],
  ['failed', 'Failed to run tests'],
  ['stopped', 'Stopped: run tests'],
  ['declined', 'Declined: run tests'],
  ['awaiting-approval', 'Waiting for approval: run tests'],
  ['unknown', 'Run tests (status unknown)'],
] as const)('uses the %s tense without reading output', (status, expected) => {
  for (const result of ['passed', 'failed']) {
    expect(commandLabel(tool({ args: { command: 'npm test' }, result }), status)).toBe(expected);
  }
});

it.each([
  ['custom --option', 'custom'],
  ['/usr/local/bin/custom arg', 'custom'],
  ['cat a && echo b', 'command'],
  ['', 'command'],
])('labels an unknown running command %s', (command, expected) => {
  expect(commandLabel(tool({ args: { command } }), 'running')).toBe(expected);
});

it('keeps the complete sanitized raw label for disclosure tooltips', () => {
  const raw = 'unknown \u001b[31m<b>\u001b[0m\n' + 'x'.repeat(50000) + '\u202e';
  const label = commandLabel(tool({ args: { command: raw } }), 'success');
  expect(label).toBe('unknown <b> ' + 'x'.repeat(50000));
});

it.each(['npm run constructor', 'git toString', 'pnpm build --fix', 'tsc --write', 'vitest --noEmit'])(
  'rejects an unknown command or option: %s',
  (command) => {
    expect(commandLabel(tool({ args: { command, description: 'Fallback' } }), 'success')).toBe('Fallback');
  },
);

it.each(['if true', 'for item in files', '! npm test'])(
  'does not treat shell control words as programs: %s',
  (command) => {
    expect(commandLabel(tool({ args: { command } }), 'running')).toBe('command');
  },
);
it.each(['head --lines invalid src/a.ts', "sed -n '1p' --unknown a"])(
  'rejects malformed read options: %s',
  (command) => {
    expect(commandLabel(tool({ args: { command, description: 'Fallback' } }), 'success')).toBe('Fallback');
  },
);

it.each(['vitest', 'pnpm exec vitest', 'npx vitest'])(
  'does not claim tests passed for discovery, setup or unsupported modes through %s',
  (prefix) => {
    for (const mode of ['list', 'list --run', 'init browser', 'bench', 'watch', 'unsupported-mode']) {
      const command = `${prefix} ${mode}`;
      expect(commandLabel(tool({ args: { command } }), 'success')).toBe(command);
      expect(commandLabel(tool({ args: { command, description: 'Inspect test configuration' } }), 'success')).toBe(
        'Inspect test configuration',
      );
    }
  },
);

it.each([
  'vitest',
  'vitest --run',
  'vitest run',
  'vitest run src/example.test.ts',
  'vitest --config vitest.config.ts run src/example.test.ts',
  'vitest run -- list',
  'pnpm exec vitest run src/example.test.ts',
  'npx vitest run src/example.test.ts',
  "bash -lc 'pnpm exec vitest run src/example.test.ts'",
])('retains the success label for a supported test execution: %s', (command) => {
  expect(commandLabel(tool({ args: { command } }), 'success')).toBe('Tests passed');
});
