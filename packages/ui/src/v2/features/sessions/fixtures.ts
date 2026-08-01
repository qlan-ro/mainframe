/**
 * Static stand-ins for the daemon's project and session lists.
 *
 * The port is a layout question, not a data question — wiring the real thread
 * list would drag the whole runtime into the clone before there's a surface
 * worth pointing it at. Shapes match what the shipped sidebar renders, so the
 * swap is a source change, not a rewrite.
 */
export interface V2Project {
  id: string;
  name: string;
  color: string;
  attention: number;
}

export interface V2Session {
  id: string;
  title: string;
  time: string;
  status: 'running' | 'idle' | 'error' | 'waiting';
  project: string;
  branch?: string;
  pr?: number;
  unread?: number;
}

export interface V2SessionGroup {
  label: string;
  sessions: V2Session[];
}

/**
 * Chart tokens, not bespoke ones: the chart ramp is the stock slot for
 * categorical colour, and a project chip is exactly that. In this preset the
 * ramp is monochrome emerald, so the four chips read as one hue at four
 * lightnesses — distinct enough to tell apart, weak as identity. A real
 * per-project palette is a token decision for later.
 */
export const PROJECTS: V2Project[] = [
  { id: 'mainframe', name: 'mainframe', color: 'var(--chart-2)', attention: 0 },
  { id: 'core-rs', name: 'core-rs', color: 'var(--chart-4)', attention: 2 },
  { id: 'mainframe-mobile', name: 'mainframe-mobile', color: 'var(--chart-1)', attention: 0 },
  { id: 'docs-site', name: 'docs-site', color: 'var(--chart-5)', attention: 0 },
];

export const SESSION_GROUPS: V2SessionGroup[] = [
  {
    label: 'Pinned',
    sessions: [
      {
        id: 's-1',
        title: 'Repair the spacing and type scales',
        time: '2m',
        status: 'running',
        project: 'mainframe',
        branch: 'design/ui-v2-clone',
        unread: 3,
      },
    ],
  },
  {
    label: 'Today',
    sessions: [
      {
        id: 's-2',
        title: 'Port the sidebar onto shadcn primitives',
        time: '14m',
        status: 'waiting',
        project: 'mainframe',
        branch: 'design/ui-v2-clone',
        pr: 544,
      },
      {
        id: 's-3',
        title: 'Axum route parity for the worktree endpoints',
        time: '1h',
        status: 'idle',
        project: 'core-rs',
        branch: 'feat/worktree-routes',
      },
      {
        id: 's-4',
        title: 'Bottom-sheet reopen wedge',
        time: '3h',
        status: 'error',
        project: 'mainframe-mobile',
      },
    ],
  },
  {
    label: 'Yesterday',
    sessions: [
      {
        id: 's-5',
        title: 'Changelog watch for CLI v2.1.220',
        time: '1d',
        status: 'idle',
        project: 'mainframe',
      },
      {
        id: 's-6',
        title: 'Adapter catalog probe cache',
        time: '1d',
        status: 'idle',
        project: 'core-rs',
        pr: 531,
      },
    ],
  },
  {
    label: 'Earlier',
    sessions: [
      { id: 's-7', title: 'Docs: sessions JSONL format', time: '4d', status: 'idle', project: 'docs-site' },
      { id: 's-8', title: 'Disk hygiene sweep', time: '6d', status: 'idle', project: 'mainframe' },
    ],
  },
];

/**
 * Stock ships one semantic hue — `destructive`. Green-for-running and
 * amber-for-waiting have no equivalent, so the four states separate on the
 * accent's intensity instead of on hue. It reads, but "waiting" losing its
 * amber is a real loss; semantic status tokens are the first thing worth adding
 * back on top of the baseline.
 */
export const STATUS_COLOR: Record<V2Session['status'], string> = {
  running: 'bg-primary',
  waiting: 'bg-primary/40',
  error: 'bg-destructive',
  idle: 'bg-muted-foreground/40',
};
