/**
 * The first-run tour's steps, and the resolution that fits them to the screen.
 *
 * The tour arms in one deterministic state — at least one project, no sessions
 * yet (see use-first-run-tour.ts) — so every step below has a live anchor. It
 * stays anchor-driven anyway: `resolveTourPlan` drops a step whose `data-tut`
 * target isn't on screen, and the label counts what survives. A step the tour
 * can't point at is never counted, which is what kept the old 4-step tour
 * saying "Step 1 of 4" and then jumping to "Step 4 of 4".
 *
 * `also` marks secondary locations for the same affordance. They get a ring but
 * no scrim cut-out: the scrim IS the primary spotlight's box-shadow, so a second
 * one would paint over the first hole.
 */

export interface TourStep {
  /** `data-tut` value of the element the spotlight rings. */
  target: string;
  /** Further `data-tut` values to ring without cutting the scrim. */
  also?: readonly string[];
  side: 'left' | 'right' | 'above' | 'below';
  title: string;
  body: string;
}

const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'add-project',
    side: 'right',
    title: 'Add a project',
    body: 'Point Mainframe at a repo on disk and it lands in this list. Add as many as you like — every session belongs to one of them.',
  },
  {
    target: 'new-session',
    also: ['new-session-row', 'new-session-tab'],
    side: 'right',
    title: 'Start a session',
    body: 'Three ways in, all the same: this +, the New Thread row above it, or the + on the tab strip. Each session gets its own conversation and worktree.',
  },
  {
    target: 'sessions-list',
    also: ['session-tabs'],
    side: 'right',
    title: 'Sessions and their tabs',
    body: 'Every session lives in this list and opens as a tab up top. Right-click either one to pin it — or to open a second session beside the first as a split.',
  },
  {
    target: 'session-rail',
    side: 'left',
    title: 'The session rail',
    body: 'Pinned to the chat’s right edge: session details, context usage, background activity, the run control, and the session’s tasks.',
  },
  {
    target: 'workspace',
    side: 'below',
    title: 'The workspace',
    body: 'Files, diffs, terminals, consoles and a live preview of your app — all tabs on one surface beside the chat, with the file tree docked on its right edge.',
  },
  {
    target: 'search',
    side: 'below',
    title: 'Search anything',
    body: 'One palette over sessions, files, symbols and commands. ⌘K from anywhere.',
  },
  {
    target: 'kanban',
    side: 'right',
    title: 'The Kanban board',
    body: 'The project’s todos, as a board — what’s open, in progress and done.',
  },
  {
    target: 'automations',
    side: 'right',
    title: 'Automations',
    body: 'Agent runs that fire on their own. Build a workflow once, then put it on a schedule.',
  },
  {
    target: 'settings',
    side: 'right',
    title: 'Reach this machine remotely',
    body: 'Settings → Remote Access opens a tunnel to this daemon, so the mobile app can drive your sessions from anywhere.',
  },
];

/** Steps the tour can show at most — the ceiling the resolved plan counts up to. */
export const TOUR_STEP_COUNT = TOUR_STEPS.length;

/**
 * Keeps the steps whose anchor is currently on screen. The result is both the
 * navigation order and the count the label reports.
 */
export function resolveTourPlan(hasAnchor: (target: string) => boolean): TourStep[] {
  return TOUR_STEPS.filter((step) => hasAnchor(step.target));
}
