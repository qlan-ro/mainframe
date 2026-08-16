/**
 * The first-run tour's step list, and the resolution that fits it to the screen
 * in front of the user.
 *
 * The tour arms only on an empty workspace, and that workspace comes in two
 * shapes — the welcome screen (a project exists but this draft has none picked)
 * and the first-run hero (no projects at all). Neither renders the composer, so
 * a step hard-wired to a composer anchor has nothing to point at.
 *
 * Each conceptual step therefore declares VARIANTS in anchor-preference order:
 * the first whose `data-tut` anchor is on screen wins. That keeps the composer
 * copy for the state that has a composer, gives the empty states their own
 * anchor and wording, and leaves the step count honest — a step with no
 * anchorable variant is dropped from the plan rather than counted and skipped.
 */

export interface TourStep {
  /** `data-tut` value of the element the spotlight rings. */
  target: string;
  side: 'right' | 'above' | 'below';
  title: string;
  body: string;
}

const TOUR_STEPS: readonly (readonly TourStep[])[] = [
  [
    {
      target: 'sessions',
      side: 'right',
      title: 'Start a session',
      body: 'Spin up a fresh agent session for any project. Every task gets its own conversation and worktree.',
    },
  ],
  [
    {
      target: 'project',
      side: 'below',
      title: 'Choose the project',
      body: 'A session runs against one repo on disk. This chip picks which — change it any time before the first message.',
    },
    {
      target: 'add-project',
      side: 'below',
      title: 'Add your first project',
      body: 'Point Mainframe at a repo on disk. Your files stay where they are; only session metadata is tracked.',
    },
  ],
  [
    {
      target: 'composer',
      side: 'above',
      title: 'Hand work to your agent',
      body: 'Describe a task in plain language and press ⏎. Mainframe plans, edits across your repo, and runs commands. Its toolbar picks the model — Claude, Codex, or Gemini — per session.',
    },
    {
      target: 'prompt',
      side: 'below',
      title: 'Hand work to your agent',
      body: 'Once the project is set, the composer opens here. Describe a task in plain language and press ⏎ — and pick the model, Claude, Codex, or Gemini, from its toolbar.',
    },
  ],
  [
    {
      target: 'workspace',
      side: 'below',
      title: 'Open the workspace',
      body: 'Files, diffs, terminals, and a live preview of your app share one surface beside the chat. Capture the screen straight back into context.',
    },
  ],
];

/** Steps the tour can show at most — the ceiling the resolved plan counts up to. */
export const TOUR_STEP_COUNT = TOUR_STEPS.length;

/**
 * Picks one variant per step against the anchors currently on screen, dropping
 * steps that have none. The result is both the navigation order and the count
 * the label reports.
 */
export function resolveTourPlan(hasAnchor: (target: string) => boolean): TourStep[] {
  return TOUR_STEPS.map((variants) => variants.find((variant) => hasAnchor(variant.target))).filter(
    (step): step is TourStep => step != null,
  );
}
