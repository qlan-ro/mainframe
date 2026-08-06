/**
 * THROWAWAY PROTOTYPE — read-only stub data for the session panel variants.
 * Nothing here reads the daemon, the store, or the active session.
 */

export type SectionId = 'session' | 'activity' | 'changes' | 'context';

export const SECTION_ORDER: readonly SectionId[] = ['session', 'activity', 'changes', 'context'];

export const SECTION_LABEL: Record<SectionId, string> = {
  session: 'Session',
  activity: 'Activity',
  changes: 'Changes',
  context: 'Context',
};

export const sessionStub = {
  branch: 'design/right-sidebar-revamp',
  worktreeBadge: 'wt',
  contextPercent: 62,
  contextDetail: '124k / 200k tokens',
  prNumber: 571,
  prState: 'open',
} as const;

export interface ActivityTaskStub {
  id: string;
  title: string;
  detail: string;
  state: 'running' | 'done';
}

export const activityStub: readonly ActivityTaskStub[] = [
  { id: 'verify', title: 'Verification sweep', detail: 'Verify: 3/5 agents', state: 'running' },
  { id: 'index', title: 'Reindex worktree', detail: 'Completed 4m ago', state: 'done' },
];

export const hasRunningActivity = activityStub.some((task) => task.state === 'running');

export interface BackgroundTaskStub {
  id: string;
  title: string;
  detail: string;
}

/**
 * Variant C's Background Activity list. In-progress work only, so there is no
 * state field — everything here is running, which is what lets the section drop
 * its completed rows. Two kinds (a workflow and a background agent) to check
 * they read apart. A and B keep `activityStub`, which still carries a done row.
 */
export const backgroundActivityStub: readonly BackgroundTaskStub[] = [
  { id: 'verify', title: 'Verification sweep', detail: 'Verify: 3/5 agents' },
  { id: 'qa-pr', title: 'qa: test PR #571', detail: 'running 2m' },
];

export interface ChangedFileStub {
  id: string;
  path: string;
  name: string;
  status: 'M' | 'A' | 'D';
  added: number;
  removed: number;
}

export const changesStub: readonly ChangedFileStub[] = [
  {
    id: 'session-panel-prototype',
    path: 'features/session-panel-prototype/',
    name: 'SessionPanelPrototype.tsx',
    status: 'A',
    added: 118,
    removed: 0,
  },
  {
    id: 'chat-surface',
    path: 'features/sessions/new-thread/',
    name: 'ChatSurface.tsx',
    status: 'M',
    added: 6,
    removed: 1,
  },
  { id: 'collapsible', path: 'v2/components/ui/', name: 'collapsible.tsx', status: 'M', added: 2, removed: 2 },
  {
    id: 'chat-sidebar-legacy',
    path: 'features/chat/thread/',
    name: 'ChatSidebarLegacy.tsx',
    status: 'D',
    added: 0,
    removed: 74,
  },
];

export const changesFindingsCount = 3;

export const changesTotals = changesStub.reduce(
  (acc, file) => ({ added: acc.added + file.added, removed: acc.removed + file.removed }),
  { added: 0, removed: 0 },
);

/** Ink per git status letter — status is a semantic, so it takes a token, not a hue. */
export const STATUS_INK: Record<ChangedFileStub['status'], string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
};

export interface ContextItemStub {
  id: string;
  label: string;
  detail: string;
}

export interface ContextGroupStub {
  id: string;
  label: string;
  items: readonly ContextItemStub[];
}

/** Shared: variant C composes its own sub-group list from these. */
export const skillsStub: readonly ContextItemStub[] = [
  { id: 'design-system-skill', label: 'mainframe-design-system', detail: 'project' },
  { id: 'tdd', label: 'test-driven-development', detail: 'user' },
];

/**
 * The memory files, which is all variant C's Context sub-group lists. The path
 * itself carries the scope — `~/.claude/…` is global, a bare `CLAUDE.md` is the
 * project's — so the row's one trailing slot stays the token size, matching the
 * Skills sub-group's rhythm.
 */
export const memoryFilesStub: readonly ContextItemStub[] = [
  { id: 'global', label: '~/.claude/CLAUDE.md', detail: '4.2k' },
  { id: 'project', label: 'CLAUDE.md', detail: '9.8k' },
];

export const contextGroupsStub: readonly ContextGroupStub[] = [
  {
    id: 'files',
    label: 'Context',
    items: [
      { id: 'chat-surface', label: 'ChatSurface.tsx', detail: '4.1k' },
      { id: 'design-system', label: 'mainframe-design-system/SKILL.md', detail: '9.8k' },
      { id: 'v2-stock', label: 'references/v2-stock.md', detail: '12.4k' },
    ],
  },
  { id: 'skills', label: 'Skills', items: skillsStub },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      { id: 'ui-dev', label: 'ui-dev', detail: 'idle' },
      { id: 'design-conformance', label: 'design-conformance', detail: 'idle' },
    ],
  },
];

export const contextItemCount = contextGroupsStub.reduce((total, group) => total + group.items.length, 0);

export interface AttachmentStub {
  id: string;
  /** Carries the extension — `fileExtMeta()` derives the tile's accent from it. */
  name: string;
  size: string;
}

/**
 * A fourth context sub-group, kept out of `contextGroupsStub` so it reaches
 * variant C only — A and B predate it and their counts would shift. Five entries
 * so a 3-across grid wraps.
 */
export const attachmentsStub: readonly AttachmentStub[] = [
  { id: 'screenshot', name: 'screenshot.png', size: '240 KB' },
  { id: 'diagram', name: 'diagram.png', size: '88 KB' },
  { id: 'api-spec', name: 'api-spec.md', size: '12 KB' },
  { id: 'design-notes', name: 'design-notes.pdf', size: '1.4 MB' },
  { id: 'trace', name: 'trace.log', size: '320 KB' },
];

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function isImageAttachment(name: string): boolean {
  return IMAGE_EXTS.has((name.split('.').pop() ?? '').toLowerCase());
}

/**
 * Shaped for assistant-ui's `agent-plan` element, which takes flat step labels
 * plus the index of the running one — everything before it is done, everything
 * after is pending. Don't restructure this into per-step states: the prototype
 * feeds the upstream component's real props.
 */
export const planStepsStub: readonly string[] = [
  'Scaffold panel structure',
  'Wire width-driven states',
  'Port Changes totals',
  'Overlay dismiss handling',
];

export const planActiveIndex = 2;

/** Badge counts shown on a section header. `session` carries no count. */
export const SECTION_COUNT: Record<SectionId, number | null> = {
  session: null,
  activity: activityStub.length,
  changes: changesStub.length,
  context: contextItemCount,
};
