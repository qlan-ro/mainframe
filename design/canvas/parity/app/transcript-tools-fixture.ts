import type { Call, Turn } from './transcript-fixture';

type Item = Record<string, unknown>;

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
        'File created',
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
        'src/codex.rs:21: pub resets_at: i64',
        12.6,
      ),
      call(
        'parity-glob',
        'Glob',
        { pattern: '**/quota*.rs', path: 'packages/core-rs' },
        ['quota.rs', 'quota_window.rs', 'routes/quota.rs', 'quota_tests.rs'].join('\n'),
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
      'Limits reset at the end of each window.',
      12.3,
    ),
    call('parity-search', 'WebSearch', { query: 'codex rate limit reset' }, 'Rate limits · OpenAI Codex docs', 12.2),
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
      '{"title":"Reset stale quota windows"}',
      12,
    ),
    call(
      'parity-lsp',
      'LSP',
      { operation: 'findReferences', filePath: 'src/codex.rs', line: 32 },
      '3 references to snapshot',
      11.9,
    ),
    call('parity-dynamic', 'docs__search', { query: 'rate limits' }, 'Rate limits · OpenAI Codex docs', 11.8),
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
