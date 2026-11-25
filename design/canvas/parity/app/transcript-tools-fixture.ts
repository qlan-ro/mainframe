import type { Call, Turn } from './transcript-fixture';

type Item = Record<string, unknown>;

const timing = (duration: number) => ({
  toolCallTiming: { startedAt: Date.now() - 100_000, completedAt: Date.now() - 100_000 + duration },
});

export function tools(turn: Turn, call: Call) {
  turn(
    'Walk me through every kind of tool card the transcript can show. Start with files, searches, edits, commands and the web.',
    '**Files, searches, edits, commands and the web.** Every row has the same shape: glyph, verb, target, receipt. Click any row with a chevron to open it.',
    13,
    [
      call(
        'parity-read',
        'Read',
        { file_path: 'quota/use-quota.ts' },
        [
          'export function useQuota(adapterId: string) {',
          '  return useQuery({',
          "    queryKey: ['quota', adapterId],",
          '    queryFn: () => api.quota.snapshot(adapterId),',
          '    // Nothing changes while every window is exhausted, so stop asking.',
          '    refetchInterval: (q) => (allExhausted(q.state.data) ? false : 60_000),',
          '  });',
          '}',
        ]
          .map((line, index) => `${index + 8}→${line}`)
          .join('\n'),
        12.9,
      ),
      call(
        'parity-write',
        'Write',
        {
          file_path: 'src/codex_tests.rs',
          content: [
            'use super::*;',
            'use chrono::{Duration, Utc};',
            '',
            '#[test]',
            'fn a_window_past_its_reset_reads_zero() {',
            '    let now = Utc::now();',
            '    // …',
            '}',
          ].join('\n'),
        },
        'File created successfully at: src/codex_tests.rs',
        12.8,
      ),
      {
        ...call('parity-edit', 'Edit', { file_path: 'src/codex.rs' }, 'File updated', 12.7),
        content: [
          { type: 'content', content: { type: 'text', text: 'File updated' } },
          {
            type: 'diff',
            changes: [{ operation: 'modify', path: 'src/codex.rs', fileType: 'text' }],
            _meta: {
              '_mainframe.dev': {
                structuredPatch: [
                  {
                    oldStart: 32,
                    oldLines: 6,
                    newStart: 32,
                    newLines: 7,
                    lines: [
                      ' pub fn snapshot(&self, now: DateTime<Utc>) -> Vec<QuotaWindow> {',
                      '     self.windows',
                      '         .iter()',
                      '-        .map(|w| QuotaWindow {',
                      '-            used_percent: w.used_percent,',
                      '+        .map(|w| match w.resets_at {',
                      '+            Some(at) if at <= now => QuotaWindow::reset(w.window),',
                      '+            _ => w.clone().into(),',
                      '         })',
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
      call(
        'parity-grep',
        'Grep',
        { pattern: 'resets_at', path: 'packages/core-rs' },
        [
          'mainframe-quota/src/codex.rs:21:    pub resets_at: Option<DateTime<Utc>>,',
          'mainframe-quota/src/codex.rs:38:            resets_at: w.resets_at,',
          'mainframe-server/src/routes/quota.rs:61:        "resets_at": w.resets_at,',
        ].join('\n'),
        12.6,
      ),
      call(
        'parity-glob',
        'Glob',
        { pattern: '**/quota*.rs', path: 'packages/core-rs' },
        [
          'crates/mainframe-quota/src/quota.rs',
          'crates/mainframe-quota/src/quota_window.rs',
          'crates/mainframe-server/src/routes/quota.rs',
          'crates/mainframe-quota/tests/quota_tests.rs',
        ].join('\n'),
        12.5,
      ),
      ...shellAndExternalCalls(call),
    ],
  );
}
function shellAndExternalCalls(call: Call): Item[] {
  return [
    call(
      'parity-bash',
      'Bash',
      { command: 'cargo test -p mainframe-quota codex', description: 'Run the quota crate tests' },
      [
        '   Compiling mainframe-quota v0.1.0',
        '    Finished `test` profile in 6.4s',
        '     Running unittests src/lib.rs',
        '',
        'running 4 tests',
        'test codex::tests::a_window_past_its_reset_reads_zero ... ok',
        'test codex::tests::parses_rate_limit_event ... ok',
        '',
        'test result: ok. 4 passed; 0 failed',
      ].join('\n'),
      12.4,
      { toolCallTiming: { startedAt: Date.now() - 100_000, completedAt: Date.now() - 93_200 } },
    ),
    call(
      'parity-fetch',
      'WebFetch',
      { url: 'https://developers.openai.com/codex/rate-limits', prompt: 'Find the rate limits' },
      `Codex enforces a rolling 5-hour window and a weekly window per account. Usage is reported in \`rate_limits\` events attached to each turn, with \`used_percent\` and \`resets_in_seconds\`. Windows reset automatically; no event is sent at reset time.`,
      12.3,
      timing(1200),
    ),
    call(
      'parity-search',
      'WebSearch',
      { query: 'codex rate limit reset' },
      [
        'Rate limits · OpenAI Codex docs',
        'developers.openai.com',
        'Usage stuck at 100% after reset',
        'github.com · issue',
        'Codex CLI changelog 0.62',
        'github.com',
        '5 more results',
      ].join('\n'),
      12.2,
    ),
    call(
      'parity-list',
      'LS',
      { path: 'packages/core-rs/crates' },
      'mainframe-adapter-claude/ mainframe-adapter-codex/ mainframe-chat/',
      12.1,
    ),
    call(
      'parity-mcp',
      'mcp__github__get_issue',
      { owner: 'qlan-ro', repo: 'mainframe', issue_number: 847 },
      [
        '{',
        '  "number": 847,',
        '  "title": "Usage capsule stuck at 100% after the weekly reset",',
        '  "state": "open",',
        '  "labels": ["bug", "area:quota"]',
        '}',
      ].join('\n'),
      12,
      timing(800),
    ),
    call(
      'parity-lsp',
      'LSP',
      { operation: 'findReferences', filePath: 'src/codex.rs', line: 32 },
      '3 references to snapshot: routes/quota.rs:58, codex.rs:32, codex_tests.rs:8',
      11.9,
      timing(300),
    ),
    call(
      'parity-dynamic',
      'docs__search',
      { query: 'rate limit windows' },
      '2 pages: rate-limits.md, usage.md',
      11.8,
      timing(600),
    ),
    {
      ...call(
        'parity-error',
        'mcp__github__get_issue',
        { owner: 'qlan-ro', repo: 'mainframe', issue_number: 8470 },
        '404 Not Found: no issue 8470 in qlan-ro/mainframe',
        11.7,
        timing(400),
      ),
      status: 'failed',
    },
    {
      ...call(
        'parity-truncated',
        'Bash',
        {
          command: 'pnpm --filter @qlan-ro/mainframe-ui exec vitest run use-quota',
          description: 'Run the quota hook tests',
        },
        [
          ' FAIL  src/features/quota/__tests__/use-quota.test.ts > stops polling when exhausted',
          'AssertionError: expected "spy" to be called 1 times, but got 2 times',
          ' ❯ use-quota.test.ts:38:24',
          '',
          ' Test Files  1 failed (1)',
          '      Tests  1 failed | 3 passed (4)',
        ].join('\n'),
        11.6,
        timing(3100),
      ),
      status: 'failed',
    },
  ];
}

export function exploration(turn: Turn, call: Call) {
  const read = (path: string, count: number) => ({
    name: 'Read',
    args: { file_path: path },
    result: Array.from({ length: count }, () => '// Quota window test').join('\n'),
  });
  const steps = [
    read('src/codex.rs', 10),
    read('src/claude.rs', 212),
    {
      name: 'Grep',
      args: { pattern: 'window', path: 'mainframe-quota' },
      result: Array.from({ length: 9 }, (_, index) => `src/codex.rs:${index + 1}:window`).join('\n'),
    },
    read('src/routes/quota.rs', 96),
    {
      name: 'Glob',
      args: { pattern: '**/snapshot*.rs' },
      result: 'src/snapshot.rs\nsrc/snapshot_tests.rs',
    },
    read('src/lib.rs', 4),
    read('src/window.rs', 31),
  ];
  turn(
    'Walk me through every kind of tool card the transcript can show. Start with files, searches, edits, commands and the web.',
    '**Files, searches, edits, commands and the web.** Every row has the same shape: glyph, verb, target, receipt. Click any row with a chevron to open it.',
    13,
    steps.map(({ name, args, result }, index) =>
      call(`parity-explore-${index}`, name, args, result, 12.9 - index / 10),
    ),
  );
}
