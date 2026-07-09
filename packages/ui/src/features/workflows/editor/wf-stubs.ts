/**
 * wf-stubs — factories for a fresh builder draft and its Add-step / Add-trigger
 * buttons. Split out of yaml-serialize.ts so neither file risks exceeding
 * 300 lines as the v2 stub shapes grow (docs/plans/2026-07-09-workflow-step-config-plan.md).
 */
import type { WfDraft, WfStep, WfStepKind, WfTrigger } from './wf-draft-types';

const STUB_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function shortId(): string {
  let s = '';
  for (let i = 0; i < 3; i++) {
    s += STUB_ID_CHARS[Math.floor(Math.random() * STUB_ID_CHARS.length)];
  }
  return s;
}

/** Returns a fresh empty draft suitable for "New workflow". */
export function blankDraft(): WfDraft {
  return {
    name: '',
    description: '',
    scope: 'project',
    triggers: [],
    inputs: [],
    vars: [],
    steps: [],
    outputs: [],
  };
}

/** Returns a stubbed step of the given kind for the builder's Add-step library. */
export function stubStep(kind: WfStepKind): WfStep {
  const id = `${kind}_${shortId()}`;
  switch (kind) {
    case 'agent':
      return { id, kind, agent: { prompt: 'Describe the task…' } };
    case 'form':
      return { id, kind, form: { title: 'Ask the user', fields: [{ key: 'answer', type: 'text' }] } };
    case 'service':
      return { id, kind, connector: 'files.append', with: { path: 'log.md', text: '${ ... }' } };
    case 'choose':
      return {
        id,
        kind,
        arms: [
          { when: 'true', steps: [] },
          { else: true, steps: [] },
        ],
      };
    case 'foreach':
      return { id, kind, over: '${ items }', as: 'item', steps: [] };
    case 'parallel':
      return { id, kind, branches: { a: [], b: [] } };
    case 'call':
      return { id, kind, ref: 'ship-work' };
    case 'set':
      return { id, kind, set: { value: null } };
  }
}

/** Returns a stubbed trigger of the given kind for the builder's Add-trigger dropdown. */
export function stubTrigger(kind: WfTrigger['kind']): WfTrigger {
  switch (kind) {
    case 'schedule':
      return { kind: 'schedule', cron: '0 9 * * *', on_missed: 'run_once', label: 'Every day at 9:00am' };
    case 'event':
      return { kind: 'event', on: 'chat.completed' };
    case 'manual':
      return { kind: 'manual' };
  }
}
