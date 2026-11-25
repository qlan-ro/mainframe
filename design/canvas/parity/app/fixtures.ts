import { parityReviewWorkflow } from './transcript-extra-fixture';
/**
 * The prototype's own data (design/redesign/prototype/index.html), as the daemon
 * would serve it. `window.__PARITY__` picks the state: the runner sets it before
 * the page loads, with the same vocabulary as the prototype's presets.
 */
import {
  addTranscriptFixture,
  delegatedTasks,
  recordedAnswer,
  statusCommand,
  type TranscriptFixture,
} from './transcript-fixture';

export const FAKE_PORT = 1;
/** 24 Nov 2026 at 23:31 UTC, when the prototype's conversation ends. The runner pins the clock to it. */
export const NOW = Date.UTC(2026, 10, 24, 23, 31, 0);

type Json = Record<string, unknown>;
export interface Scenario {
  /** The session's own turn is running. */
  running?: boolean;
  /** Which of the prototype's activity lists the session shows. */
  act?: 'none' | 'run' | 'need' | 'many' | 'all';
  changes?: boolean;
  gate?: 'permission' | 'question' | 'plan';
  queue?: boolean;
  ctx?: number;
  perm?: 'default' | 'acceptEdits' | 'auto' | 'yolo';
  env?: 'worktree' | 'local' | 'temp';
  attachments?: number;
  /** The workspace's own two launch configurations, running or not. */
  launch?: 'one-stopped' | 'two' | 'two-stopped';
  projects?: 'none';
  /** A session with no transcript rows (the transcript area is #948's). */
  blank?: boolean;
  transcript?: TranscriptFixture;
  transcriptCall?: string;
}
export const scenario: Scenario = (window as unknown as { __PARITY__?: Scenario }).__PARITY__ ?? {};

const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const atMs = (minutes: number) => NOW - minutes * 60_000;

/* ---------- projects ---------- */
// The avatar's colour is hashed from the project id; these ids land on the prototype's three.
const project = (id: string, name: string) => ({
  id,
  name,
  path: `/Users/dev/${name}`,
  createdAt: ago(90_000),
  lastOpenedAt: ago(5),
  available: true,
});
export const PROJECTS =
  scenario.projects === 'none'
    ? []
    : [project('mainframe-ui', 'mainframe-ui'), project('contact-ui', 'contact-ui'), project('docs', 'docs')];
const SCRATCH = 'no-project';

/* ---------- sessions (TPL in the prototype) ---------- */
const chat = (id: string, title: string, minutes: number, extra: Json = {}): Json => ({
  id,
  adapterId: 'claude',
  projectId: 'mainframe-ui',
  title,
  claudeSessionId: `vendor-${id}`,
  model: 'opus-4.5',
  effort: 'high',
  permissionMode: 'acceptEdits',
  planMode: false,
  status: 'active',
  createdAt: ago(minutes + 30),
  updatedAt: ago(minutes),
  totalCost: 0,
  totalTokensInput: 0,
  totalTokensOutput: 0,
  lastContextTokensInput: 0,
  lastContextTotalTokens: 82_000,
  lastContextMaxTokens: 200_000,
  displayStatus: 'idle',
  isRunning: false,
  temporary: false,
  noProject: false,
  detectedPrs: [],
  tags: [],
  mentions: [],
  modifiedFiles: [],
  ...extra,
});

const worktree = (branch: string): Json => ({
  worktreePath: `/Users/dev/.mainframe/worktrees/${branch.replace('/', '-')}`,
  branchName: branch,
});

const PR = {
  url: 'https://github.com/qlan-ro/mainframe/pull/912',
  owner: 'qlan-ro',
  repo: 'mainframe',
  number: 912,
  source: 'created',
};

const main = (): Json => {
  const ctx = scenario.ctx ?? 41;
  const env = scenario.env ?? 'worktree';
  return chat('s1', 'Fix stuck Codex limits in the usage capsule', 2, {
    ...(env === 'worktree' ? worktree('feat/quota-reset') : { branchName: 'main' }),
    temporary: env === 'temp',
    permissionMode: scenario.perm ?? (scenario.gate === 'plan' ? 'acceptEdits' : 'acceptEdits'),
    planMode: scenario.gate === 'plan',
    lastContextTotalTokens: ctx * 2000,
    detectedPrs: [PR],
    isRunning: scenario.running === true,
    displayStatus: scenario.gate ? 'waiting' : scenario.running || act() !== 'none' ? 'working' : 'idle',
    ...(act() === 'none' ? {} : { backgroundActivity: activity() }),
    todos: PLAN,
  });
};

const act = (): NonNullable<Scenario['act']> => scenario.act ?? 'run';

const PLAN = [
  { content: 'Read the quota and capsule code', activeForm: 'Reading the quota and capsule code', status: 'completed' },
  { content: 'Fix snapshot() in the daemon', activeForm: 'Fixing snapshot() in the daemon', status: 'completed' },
  {
    content: 'Adding the scope helper to the UI lib',
    activeForm: 'Adding the scope helper to the UI lib',
    status: 'in_progress',
  },
  { content: 'Write the hook test', activeForm: 'Writing the hook test', status: 'pending' },
  { content: 'Open the PR', activeForm: 'Opening the PR', status: 'pending' },
];

export const chats = (): Json[] => [
  main(),
  ...(scenario.transcript === 'delegated'
    ? delegatedTasks.map(({ childChatId, title, adapterId, taskId, status }) =>
        chat(childChatId, title, 12, {
          adapterId,
          parentChatId: 's1',
          isRunning: status === 'running',
          delegatedWaiting: status === 'waiting',
          delegation: { taskId, status, role: 'general' },
        }),
      )
    : []),
  chat('s2', 'Reuse an existing worktree branch in automation steps', 12, {
    ...worktree('fix/automation-reuse-branch'),
    isRunning: true,
    displayStatus: 'working',
  }),
  chat('s3', 'Add a scope switcher to the review header', 31, { branchName: 'main', displayStatus: 'waiting' }),
  chat('s4', 'Session panel sections for side chat', 33, {
    ...worktree('feat/panel-sections'),
    displayStatus: 'waiting',
    planMode: true,
  }),
  chat('s5', 'Prepare release v2.15.0', 33.2, {
    adapterId: 'codex',
    model: 'gpt-5.1-codex',
    effort: 'medium',
    permissionMode: 'default',
    branchName: 'main',
  }),
  chat('s6', 'Label Claude models by displayName', 33.4, { temporary: true, model: 'sonnet-4.5' }),
  chat('s7', 'e-Factura SPV retry', 60, {
    projectId: 'contact-ui',
    branchName: 'main',
    isRunning: true,
    displayStatus: 'working',
  }),
  chat('s8', 'Draft dividend checks', 1441, { projectId: 'contact-ui', branchName: 'main' }),
  chat('s9', 'Trace how ask_agent picks its worktree', 1442, { branchName: 'main' }),
  chat('s10', 'Resizable transcript width', 1443, { branchName: 'main' }),
  chat('s11', 'Untitled session', 2890, { projectId: SCRATCH, noProject: true, temporary: true }),
];

/* ---------- activity ---------- */
const task = (id: string, kind: string, description: string, minutes: number, extra: Json = {}): Json => ({
  id,
  kind,
  toolName: 'Bash',
  toolUseId: `call-${id}`,
  command: '',
  description,
  outputPath: null,
  startedAt: atMs(minutes),
  endedAt: null,
  status: 'running',
  lastOutputLine: null,
  summary: null,
  usage: null,
  ...extra,
});
const RUN = [
  task('a1', 'agent', 'Map diff scopes in the daemon', 37),
  task('a2', 'workflow', 'review-readiness', 37, { workflowName: 'review-readiness', runId: 'wf1' }),
  task('a3', 'agent', 'Accessibility review of the scope switcher', 37),
];
const NEED = task('a0', 'agent', 'Review the quota reset diff', 36);
const ended = (id: string, kind: string, text: string, status: string, minutes: number) =>
  task(id, kind, text, minutes + 3, { status, endedAt: atMs(minutes) });
const EARLIER = [
  ...['Review the scope diff', 'Check the readiness gate', 'Rerun the typecheck'].map((text, i) =>
    ended(`f${i}`, 'agent', text, 'failed', 60 + i),
  ),
  ...Array.from({ length: 21 }, (_, i) =>
    ended(`d${i}`, 'agent', `Explore the rate-limit sources ${i + 1}`, 'completed', 70 + i),
  ),
];
const ALL = [
  task('v2', 'agent', 'Accessibility review of the capsule', 5),
  task('v3', 'agent', 'Review the quota reset diff', 4),
  task('v5', 'workflow', 'release-checks', 3, { workflowName: 'release-checks', runId: 'wf5' }),
  task('v6', 'bash', 'pnpm dev until "ready"', 5.1, { toolName: 'Monitor', command: 'pnpm dev' }),
  task('v7', 'bash', 'pnpm test --run', 1.67, { command: 'pnpm test --run' }),
  ended('e1', 'agent', 'Explore the rate-limit sources', 'completed', 60),
  ended('e3', 'workflow', 'nightly-audit', 'completed', 61),
  ended('e9', 'agent', 'Translate the release notes', 'failed', 62),
  ended('e10', 'agent', 'Profile the capsule render', 'stopped', 63),
];
const live = (): Json[] => {
  switch (act()) {
    case 'none':
      return [];
    case 'run':
      return RUN;
    case 'need':
      return [NEED, ...RUN];
    case 'many':
      return [NEED, ...RUN, task('a4', 'bash', 'Typecheck packages/ui', 2, { command: 'Typecheck packages/ui' })];
    case 'all':
      return ALL;
  }
};
const activity = () => {
  const tasks = live().filter((t) => t.status === 'running');
  return {
    total: tasks.length,
    byKind: {},
    tasks: tasks.map((t) => ({
      id: t.id,
      kind: t.kind,
      description: t.description,
      startedAt: t.startedAt,
      workflowName: t.workflowName,
      runId: t.runId,
    })),
  };
};

/* ---------- adapters, settings, quota ---------- */
const model = (id: string, label: string, efforts: string[], extra: Json = {}) => ({
  id,
  label,
  supportedEfforts: efforts,
  defaultEffort: 'high',
  ...extra,
});
const adapter = (id: string, name: string, models: unknown[], autoMode: boolean) => ({
  id,
  name,
  description: name,
  installed: true,
  version: '2.0.0',
  models,
  modelsRevision: 1,
  catalogSource: 'probed',
  capabilities: { planMode: true, autoMode, fork: true, steer: true, noPersistence: true },
});
const ADAPTERS = [
  adapter(
    'claude',
    'Claude',
    [
      model('opus-4.5', 'Opus 4.5', ['low', 'medium', 'high', 'max'], { isDefault: true }),
      model('sonnet-4.5', 'Sonnet 4.5', ['low', 'medium', 'high']),
      model('haiku-4.5', 'Haiku 4.5', ['low', 'medium', 'high']),
    ],
    true,
  ),
  adapter(
    'codex',
    'Codex',
    [
      model('gpt-5.1-codex', 'GPT-5.1 Codex', ['low', 'medium', 'high'], { isDefault: true }),
      model('gpt-5.1-codex-mini', 'GPT-5.1 Codex Mini', ['low', 'medium', 'high']),
    ],
    false,
  ),
];
const QUOTA: Record<string, Json> = {
  claude: {
    status: 'ok',
    weekly: { kind: 'weekly', usedPercent: 42, resetsAt: NOW + (3 * 24 + 2) * 3_600_000 + 60_000 },
    modelWindows: [],
    observedAt: NOW,
  },
  codex: {
    status: 'ok',
    session: { kind: 'session', usedPercent: 18, resetsAt: NOW + 130 * 60_000 + 30_000 },
    modelWindows: [],
    observedAt: NOW,
  },
};
const GENERAL = {
  worktreeDir: '.worktrees',
  notifications: {
    chat: { taskComplete: true, sessionError: true, attentionRequest: true },
    permission: { toolRequest: true, userQuestion: true, planApproval: true },
    other: { plugin: true },
  },
  updateChannel: 'stable',
  defaultAdapterId: 'claude',
  idleCompaction: { enabled: false },
};

/* ---------- project data ---------- */
const todo = (number: number, title: string) => ({
  id: `t${number}`,
  number,
  project_id: 'mainframe-ui',
  title,
  body: '',
  status: 'open',
  type: 'feature',
  priority: 'medium',
  labels: [],
  assignees: [],
  milestone: null,
  dependencies: [],
  order_index: 100 - number,
  created_at: ago(4000),
  updated_at: ago(4000),
});
const TODOS = [
  todo(24, 'claude: --permission-mode auto is ignored after resume'),
  todo(23, 'Remember file tree expansion state per project'),
  todo(22, 'Preview captures do not include native scrollbars'),
];
const BRANCHES = ['main', 'develop', 'release/2.15', 'refactor/daemon-baseline'];
const WORKTREES = ['feat/quota-reset', 'feat/composer-v2', 'fix/ws-reconnect'];
const CHANGES = [
  { path: 'packages/core-rs/crates/mainframe-quota/src/codex.rs', additions: 8, deletions: 1 },
  { path: 'packages/core-rs/crates/mainframe-quota/src/codex_tests.rs', additions: 12, deletions: 0 },
  { path: 'packages/ui/src/features/quota/use-quota.ts', additions: 2, deletions: 0 },
];
const changes = () => (scenario.changes === false ? [] : CHANGES);
const LAUNCH = (
  scenario.launch === 'one-stopped'
    ? ['dev']
    : scenario.launch
      ? ['dev', 'daemon']
      : ['ui-dev', 'daemon', 'typecheck', 'storybook-design-system-preview…']
).map((name, i) => ({
  name,
  runtimeExecutable: 'pnpm',
  runtimeArgs: ['dev'],
  port: i === 0 ? 5173 : null,
  url: null,
  preview: i === 0,
}));
const bytes = (tokens: number) => 'x'.repeat(tokens * 4);
const mention = (path: string, i: number) => ({
  id: `m${i}`,
  kind: 'file',
  source: 'user',
  name: path.split('/').pop(),
  path,
  timestamp: ago(20 + i),
});
const EXT = ['csv', 'png', 'log', 'pdf', 'diff', 'md', 'json', 'txt'];
const CONTEXT = () => ({
  globalFiles: [{ path: '/Users/dev/.codex/AGENTS.md', content: bytes(418), source: 'global' }],
  projectFiles: [{ path: 'AGENTS.md', content: bytes(53), source: 'project' }],
  mentions: ['docs/review-workflow.md', 'src/git.ts', 'docs/quota.md', 'src/usage.ts'].map(mention),
  attachments: EXT.slice(0, scenario.attachments ?? 2).map((ext, i) => ({
    id: `att${i}`,
    name: `file.${ext}`,
    mediaType: 'text/plain',
    sizeBytes: 100,
    kind: 'file',
  })),
  modifiedFiles: changes().map((c) => c.path),
  skillFiles: [
    { path: '/Users/dev/.agents/skills/mainframe-design-system/SKILL.md', displayName: 'mainframe-design-system' },
    { path: '/Users/dev/.agents/skills/ui-design/SKILL.md', displayName: 'ui-design' },
  ],
});
const TREE: Record<string, [string, 'directory' | 'file'][]> = {
  '.': [
    ['packages', 'directory'],
    ['PRODUCT.md', 'file'],
    ['package.json', 'file'],
  ],
  packages: [
    ['core-rs', 'directory'],
    ['ui', 'directory'],
  ],
};
const CODE = [
  "import { useUsage } from '@/features/usage/use-usage';",
  "import { cn } from '@/lib/utils';",
  '',
  'export function UsageCapsule() {',
  '  const { windows, next } = useUsage();',
  '  const w = windows[0];',
  '  if (!w) return null;',
  '  // Codex resets its 5h window server-side: trust resetsAt, not the cached %.',
  '  const pct = w.resetsAt <= Date.now() ? 0 : w.percent;',
  '  return (',
  "    <button className={cn('capsule', pct >= 80 && 'warn')} onClick={next}>",
  '      <span>{w.provider}</span>',
  '      <Meter value={pct} />',
  '      <b>{pct}%</b>',
  '    </button>',
  '  );',
  '}',
].join('\n');
const SWITCH_ORIGINAL = [
  'impl QuotaWindow {',
  '    pub fn percent(&self, now: DateTime<Utc>) -> u8 {',
  '        self.cached_percent',
  '    }',
  '',
  '    fn stale(&self) -> bool { false }',
  '}',
  '',
].join('\n');
const SWITCH_MODIFIED = [
  'impl QuotaWindow {',
  '    pub fn percent(&self, now: DateTime<Utc>) -> u8 {',
  '        if now >= self.resets_at {',
  '            return 0;',
  '        }',
  '        self.cached_percent',
  '    }',
  '',
  '    fn stale(&self, now: DateTime<Utc>) -> bool {',
  '        now >= self.resets_at',
  '    }',
  '}',
  '',
].join('\n');

/* ---------- HTTP ---------- */
const ok = (data: unknown) => ({ success: true, data });

export function respond(method: string, url: URL, _body: unknown): unknown {
  const path = url.pathname;
  const is = (re: RegExp) => re.exec(path);
  if (path === '/health') return { status: 'ok' };
  let m: RegExpExecArray | null;
  if (method === 'GET') {
    if (path === '/api/projects') return ok(PROJECTS);
    if (path === '/api/adapters') return ok(ADAPTERS);
    if (path === '/api/chats') return ok(chats());
    if (path === '/api/tags') return ok([]);
    if (path === '/api/commands') return ok([{ name: 'compact', description: 'Compact', source: 'claude' }]);
    if (path === '/api/settings/general') return ok(GENERAL);
    if (path === '/api/settings/providers')
      return ok({ claude: { defaultModel: 'opus-4.5', defaultMode: 'acceptEdits', defaultEffort: 'high' }, codex: {} });
    if (path === '/api/providers/cli-status') return ok([]);
    if (path === '/api/tunnel/ports') return ok({ daemonPort: FAKE_PORT, tunnels: [] });
    if (path === '/api/plugins/todos/todos')
      return { todos: url.searchParams.get('projectId') === 'mainframe-ui' ? TODOS : [] };
    if (path.startsWith('/api/plugins/todos/github')) return { link: null, pairs: [], remotes: [] };
    if (path.startsWith('/api/automation')) return ok([]);
    if ((m = is(/^\/api\/providers\/(\w+)\/quota$/))) return ok(QUOTA[m[1]!]);
    if ((m = is(/^\/api\/adapters\/\w+\/(skills|agents)$/))) return ok([]);
    if (is(/^\/api\/adapters\/\w+\/config-conflicts$/)) return ok({ conflicts: [] });
    if (is(/^\/api\/adapters\/\w+\/effective-model$/)) return ok(null);
    if ((m = is(/^\/api\/chats\/([\w-]+)$/))) return ok(chats().find((c) => c.id === m![1]));
    if ((m = is(/^\/api\/chats\/([\w-]+)\/workflow-runs$/)))
      return ok(m[1] === 's1' && scenario.transcript === 'extraTools' ? [parityReviewWorkflow] : []);
    if ((m = is(/^\/api\/chats\/([\w-]+)\/background-tasks$/)))
      return ok({ tasks: m[1] === 's1' ? [...live(), ...EARLIER] : [] });
    if (is(/^\/api\/chats\/[\w-]+\/context$/)) return ok(CONTEXT());
    if (is(/^\/api\/chats\/[\w-]+\/segments$/)) return ok([]);
    if (is(/^\/api\/chats\/[\w-]+\/session-files$/)) return ok({ files: changes() });
    if ((m = is(/^\/api\/projects\/[\w-]+\/git\/([\w-]+)$/))) {
      const branch =
        url.searchParams.get('chatId') === 's1' && (scenario.env ?? 'worktree') === 'worktree'
          ? 'feat/quota-reset'
          : 'main';
      if (m[1] === 'branch') return ok({ branch });
      if (m[1] === 'branches')
        return ok({
          current: branch,
          local: BRANCHES.map((name) => ({
            name,
            current: name === branch,
            worktree: WORKTREES.includes(name)
              ? `/Users/dev/.mainframe/worktrees/${name.replace('/', '-')}`
              : undefined,
          })),
          remote: [],
          worktrees: WORKTREES,
        });
      if (m[1] === 'working-stat')
        return ok({
          files: changes(),
          totalAdditions: changes().reduce((n, c) => n + c.additions, 0),
          totalDeletions: changes().reduce((n, c) => n + c.deletions, 0),
        });
      if (m[1] === 'status') return ok({ files: changes().map((c) => ({ status: 'M', path: c.path })) });
      if (m[1] === 'worktrees')
        return ok({
          worktrees: [
            { path: '/Users/dev/mainframe-ui', branch: 'refs/heads/main' },
            ...WORKTREES.map((branch) => ({
              path: `/Users/dev/.mainframe/worktrees/${branch.replace('/', '-')}`,
              branch: `refs/heads/${branch}`,
            })),
          ],
        });
      if (m[1] === 'branch-diffs') return ok({ branch, baseBranch: 'main', mergeBase: 'abc', files: changes() });
      if (m[1] === 'diff') return ok({ original: SWITCH_ORIGINAL, modified: SWITCH_MODIFIED, diff: '', status: 'M' });
      if (m[1] === 'github-remotes') return ok({ remotes: [] });
    }
    if (is(/^\/api\/projects\/[\w-]+\/launch\/status$/))
      return ok({
        statuses: scenario.launch?.endsWith('-stopped') ? {} : { [LAUNCH[0]!.name]: 'running' },
        tunnelUrls: {},
        outputs: {},
        effectivePath: scenario.launch ? '/Users/dev/.mainframe/worktrees/feat-quota-reset' : '/Users/dev/mainframe-ui',
      });
    if (is(/^\/api\/projects\/[\w-]+\/launch\/configs$/)) return ok(LAUNCH);
    if (is(/^\/api\/projects\/[\w-]+\/tree$/)) {
      const dir = url.searchParams.get('path') ?? '.';
      return ok((TREE[dir] ?? []).map(([name, type]) => ({ name, type, path: dir === '.' ? name : `${dir}/${name}` })));
    }
    if (is(/^\/api\/projects\/[\w-]+\/files$/)) return ok({ content: CODE, path: url.searchParams.get('path') });
    if (is(/^\/api\/projects\/[\w-]+\/search\/files$/)) return ok([]);
    if (is(/^\/api\/projects\/[\w-]+\/external-sessions$/)) return ok({ sessions: [], total: 0, hasMore: false });
    if (is(/^\/api\/projects\/[\w-]+\/paths\/resolve$/)) return ok({ exists: false });
  }
  if (method === 'POST' && is(/^\/api\/chats\/[\w-]+\/resume$/)) return { success: true };
  // Never answered, so a Stop stays on its way.
  if (method === 'POST' && is(/^\/api\/chats\/[\w-]+\/interrupt$/)) return new Promise(() => {});
  if (method === 'POST' && path === '/api/session-transcripts/resolve') return ok({ resolutions: [] });
  if (method === 'PATCH' && (m = is(/^\/api\/chats\/([\w-]+)\//))) return ok(chats().find((c) => c.id === m![1]));
  return undefined;
}

/* ---------- ACP ---------- */
const MF = '_mainframe.dev';
let seq = 0;
const stamp = (minutes: number, extra: Json = {}) => ({
  [MF]: { created: true, timestamp: ago(minutes), containerId: `c${seq}`, ...extra },
});
const user = (text: string, minutes: number): Json => {
  seq++;
  return {
    sessionUpdate: 'user_message',
    messageId: `u${seq}`,
    content: [{ type: 'text', text }],
    _meta: stamp(minutes),
  };
};
const agent = (text: string, minutes: number, durationMs?: number): Json => {
  const messageId = `a${seq}-${minutes}`;
  return {
    sessionUpdate: 'agent_message',
    messageId,
    content: [{ type: 'text', text }],
    _meta: stamp(minutes, durationMs === undefined ? {} : recordedAnswer(messageId, text.length, durationMs)),
  };
};
const call = (
  id: string,
  title: string,
  rawInput: Json,
  rawOutput: unknown,
  minutes: number,
  extra: Json = {},
): Json => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: id,
  title,
  kind: 'other',
  status: rawOutput === undefined ? 'in_progress' : 'completed',
  rawInput,
  ...(rawOutput === undefined
    ? {}
    : { rawOutput, content: [{ type: 'content', content: { type: 'text', text: String(rawOutput) } }] }),
  _meta: stamp(minutes, extra),
});

function transcript(): Json[] {
  seq = 0;
  if (scenario.blank) return [];
  const out: Json[] = [];
  /** A sub-agent's own call, waiting on a request above the composer. */
  const asking: Json[] =
    act() === 'need' || act() === 'many'
      ? [
          {
            ...call(
              'call-a0',
              'Task',
              {
                description: 'Review the quota reset diff',
                prompt: 'Review it',
                subagent_type: 'code-reviewer',
                run_in_background: true,
              },
              'started',
              12.6,
            ),
            _meta: stamp(12.5, { subagent: true }),
          },
          {
            ...call('gate-sub', 'Bash', { command: 'git diff main...HEAD' }, undefined, 12.6),
            _meta: stamp(12.5, { parentToolCallId: 'call-a0' }),
          },
        ]
      : [];
  const turn = (q: string, a: string, minutes: number, calls: Json[] = [], durationMs?: number) => {
    out.push(user(q, minutes));
    seq++;
    out.push(
      ...calls
        .filter((c) => !scenario.transcriptCall || c.toolCallId === scenario.transcriptCall)
        .map((c) => ({
          ...c,
          _meta: stamp(minutes - 0.5, { ...c._meta?.[MF], containerId: `c${seq}` }),
        })),
      ...(minutes === 13 ? asking : []),
      agent(a, minutes - 1, durationMs),
    );
  };
  if (scenario.transcript) {
    addTranscriptFixture(scenario.transcript, turn, call);
    return out;
  }
  turn(
    'The usage capsule stays at 100% after the Codex window resets. Can you find out why?',
    'Found it. Two things together freeze the capsule.',
    13,
    [
      call(
        'call-a1',
        'Task',
        {
          description: 'Map diff scopes in the daemon',
          prompt: 'Map them',
          subagent_type: 'general-purpose',
          run_in_background: true,
        },
        'started',
        12.6,
      ),
      call(
        'call-a3',
        'Task',
        {
          description: 'Accessibility review of the scope switcher',
          prompt: 'Review it',
          subagent_type: 'general-purpose',
          run_in_background: true,
        },
        'started',
        12.6,
      ),
      call(
        'w1',
        'ScheduleWakeup',
        {
          delaySeconds: (52 + 12.5) * 60 + 20,
          reason: 'Check the review-readiness workflow',
          prompt: 'Check the review-readiness workflow',
        },
        '{}',
        12.6,
      ),
      call(
        'w2',
        'CronCreate',
        { prompt: 'Post the review status to the PR', cron: '0 9 * * 1-5', recurring: true },
        '{"id":"c1","humanSchedule":"Every weekday at 09:00","recurring":true}',
        12.6,
      ),
    ],
  );
  turn('Makes sense. Fix it in the daemon and add a test.', 'Fixed in both places.', 11);
  turn(
    'Get a second opinion: have one agent review the diff and another check the mobile capsule.',
    'Both checks are back. The diff is correct, with one nit.',
    5,
  );
  if (scenario.running) {
    out.push(user('Now cover the weekly window too.', 0.5));
    seq++;
  }
  return out;
}

const option = (optionId: string, name: string, kind: string) => ({ optionId, name, kind });
const TRIAD = [
  option('allow_once', 'Allow once', 'allow_once'),
  option('allow_always', 'Always allow', 'allow_always'),
  option('reject_once', 'Reject', 'reject_once'),
];
const gate = (
  toolName: string,
  input: Json,
  options: unknown[],
  suggestions: unknown[] = [],
  id = 'gate-call',
): Json => ({
  title: toolName,
  subject: { type: 'tool_call', toolCall: { toolCallId: id, title: toolName, rawInput: input } },
  options,
  _meta: { [MF]: { controlRequest: { requestId: 'r1', toolUseId: id, toolName, input, suggestions, options } } },
});
function permissions(): Json[] {
  if (scenario.transcript === 'awaitingApproval')
    return [gate('Bash', { command: statusCommand }, TRIAD, [], 'parity-approval')];

  if (scenario.gate === 'permission')
    return [
      gate(
        'Bash',
        {
          command: 'cargo test -p mainframe-quota -- --include-ignored',
          description: 'Run the quota tests, including the ignored network ones',
        },
        TRIAD,
        [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'cargo test *' }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      ),
    ];
  if (scenario.gate === 'question')
    return [
      gate(
        'AskUserQuestion',
        {
          questions: [
            {
              header: 'ReviewScope',
              question: 'Rename the ReviewScope members before adding the switcher?',
              multiSelect: false,
              options: [
                {
                  label: 'Rename first (Recommended)',
                  description: 'Cleaner diff, touches the 6 files that import ReviewScope',
                },
                { label: 'Add the switcher first', description: 'Smaller change now, rename in a follow-up' },
              ],
            },
          ],
        },
        TRIAD,
      ),
    ];
  if (scenario.gate === 'plan')
    return [
      gate(
        'ExitPlanMode',
        {
          plan: '#### Session panel sections in the side chat\n\n1. Add a Sections menu to the panel header, one toggle per section.\n2. Persist the choice per user in ui-prefs.\n3. Mount the same panel in the side chat, reading the same prefs.',
        },
        TRIAD,
      ),
    ];
  if (act() === 'need' || act() === 'many')
    return [
      gate(
        'Bash',
        {
          command: 'git diff main...HEAD -- packages/core-rs/crates/mainframe-quota',
          description: 'Read the quota changes for the review',
        },
        [TRIAD[0], TRIAD[2]],
        [],
        'gate-sub',
      ),
    ];
  return [];
}

export const TODOS_EVENT = { type: 'todos.updated', chatId: 's1', todos: PLAN };

export function sessionState(id: string): { updates: Json[]; queue: Json[]; permissions: Json[] } {
  if (id !== 's1') return { updates: [user('Hello', 60), agent('Hi', 59)], queue: [], permissions: [] };
  const running = scenario.running || scenario.gate;
  return {
    updates: [
      ...transcript(),
      {
        sessionUpdate: 'state_update',
        state: running ? 'running' : 'idle',
        ...(running ? { _meta: { [MF]: { startedAtMs: NOW - 30_000 } } } : { stopReason: 'end_turn' }),
      },
      {
        sessionUpdate: 'usage_update',
        used: (scenario.ctx ?? 41) * 2000,
        size: 200_000,
        _meta: { [MF]: { percentage: scenario.ctx ?? 41 } },
      },
    ],
    queue: scenario.queue
      ? ['Then rerun the quota tests on Codex.', 'Open a PR when they pass.'].map((content, i) => ({
          messageId: `q${i}`,
          chatId: 's1',
          uuid: `q${i}`,
          content,
          timestamp: ago(1),
        }))
      : [],
    permissions: permissions(),
  };
}
