/**
 * Demo run data for the fixture gateway's dev-preview experience (Phase 5)
 * — one seeded run per a handful of the six canonical automations, each with
 * a matching `AutomationTimelineEntry[]` (contract §2's checkpoint `steps`
 * map, flattened) built from the fixture's REAL step ids, never invented
 * ones. Covers waiting (+ a pending interaction), running-with-repeat-fan-
 * out, and failed; `succeeded`/`cancelled`/kept-going are exercised directly
 * by component-level tests instead of here (this module only needs to be
 * "good enough for a dev preview", not exhaustive over every run status —
 * ts153 wf2-seeds.jsx `WF2_RUNS_SEED`/`WF2_NOTIFS`, ported onto the real
 * contract types and real fixture step ids instead of mock ones).
 */
import type {
  AutomationFormField,
  AutomationInteractionSummary,
  AutomationRunSummary,
  AutomationSummary,
  AutomationTimelineEntry,
} from '../contract';
import { findStepById } from '../domain/tokens';

function askMeFields(automation: AutomationSummary, stepId: string): AutomationFormField[] {
  const step = findStepById(automation.definition.steps, stepId);
  return step?.kind === 'ask_me' ? step.fields : [];
}

export interface DemoRunSeeds {
  runs: AutomationRunSummary[];
  timelines: Map<string, AutomationTimelineEntry[]>;
  interactions: AutomationInteractionSummary[];
}

/** Builds the demo runs for whichever of the seeded automations are present, matched by name (ids are assigned fresh per gateway instance). */
export function buildDemoRuns(
  definitions: AutomationSummary[],
  nextId: (prefix: string) => string,
  now: () => number,
): DemoRunSeeds {
  const runs: AutomationRunSummary[] = [];
  const timelines = new Map<string, AutomationTimelineEntry[]>();
  const interactions: AutomationInteractionSummary[] = [];
  const byName = (name: string) => definitions.find((d) => d.name === name);

  const shipWork = byName('Ship work');
  if (shipWork) {
    const runId = nextId('run');
    const t = now();
    const interactionId = nextId('interaction');
    runs.push({
      id: runId,
      automationId: shipWork.id,
      status: 'waiting',
      trigger: { kind: 'manual' },
      startedAt: t,
      finishedAt: null,
      error: null,
    });
    timelines.set(runId, [
      {
        stepRef: 'ask-ado-link',
        stepId: 'ask-ado-link',
        kind: 'ask_me',
        status: 'waiting',
        interactionId,
        startedAt: t,
      },
      { stepRef: 'if-create-new', stepId: 'if-create-new', kind: 'if', status: 'skipped' },
      { stepRef: 'create-pr', stepId: 'create-pr', kind: 'run_action', status: 'skipped' },
      { stepRef: 'cleanup-worktree', stepId: 'cleanup-worktree', kind: 'ask_agent', status: 'skipped' },
    ]);
    interactions.push({
      id: interactionId,
      runId,
      stepRef: 'ask-ado-link',
      title: 'Link an ADO item?',
      fields: askMeFields(shipWork, 'ask-ado-link'),
      status: 'pending',
      createdAt: t,
      resolvedAt: null,
    });
  }

  const prSweep = byName('Morning PR sweep');
  if (prSweep) {
    const runId = nextId('run');
    const t = now();
    runs.push({
      id: runId,
      automationId: prSweep.id,
      status: 'running',
      trigger: { kind: 'schedule' },
      startedAt: t,
      finishedAt: null,
      error: null,
    });
    timelines.set(runId, [
      {
        stepRef: 'list-open-prs',
        stepId: 'list-open-prs',
        kind: 'run_action',
        status: 'succeeded',
        outputPreview: '3 open PRs',
        startedAt: t,
        finishedAt: t + 600,
      },
      { stepRef: 'repeat-prs', stepId: 'repeat-prs', kind: 'repeat', status: 'running', startedAt: t + 700 },
      {
        stepRef: 'ask-review-pr#1',
        stepId: 'ask-review-pr',
        kind: 'ask_agent',
        status: 'succeeded',
        chatId: 'chat-pr-2118',
        startedAt: t + 700,
        finishedAt: t + 100700,
      },
      {
        stepRef: 'ask-review-pr#2',
        stepId: 'ask-review-pr',
        kind: 'ask_agent',
        status: 'failed',
        error: 'Rate limited by GitHub — skipped this PR.',
        startedAt: t + 100800,
        finishedAt: t + 112800,
      },
      {
        stepRef: 'ask-review-pr#3',
        stepId: 'ask-review-pr',
        kind: 'ask_agent',
        status: 'running',
        chatId: 'chat-pr-2131',
        startedAt: t + 113000,
      },
    ]);
  }

  const prReview = byName('PR auto-review');
  if (prReview) {
    const runId = nextId('run');
    const t = now();
    const error = 'The agent could not check out the branch — worktree was locked by another session.';
    runs.push({
      id: runId,
      automationId: prReview.id,
      status: 'failed',
      trigger: { kind: 'webhook' },
      startedAt: t,
      finishedAt: t + 22000,
      error,
    });
    timelines.set(runId, [
      {
        stepRef: 'ask-codex-review',
        stepId: 'ask-codex-review',
        kind: 'ask_agent',
        status: 'failed',
        error,
        startedAt: t,
        finishedAt: t + 22000,
      },
    ]);
  }

  return { runs, timelines, interactions };
}
