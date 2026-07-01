import type { RunRecord } from '../store/types.js';
import type { Scope } from './types.js';

export function rootScope(run: RunRecord): Scope {
  return {
    inputs: run.inputs,
    vars: {},
    trigger: { kind: run.triggerKind, payload: run.triggerPayload },
    run: {
      id: run.id,
      workflowId: run.workflowId,
      startedAt: run.startedAt,
      date: new Date(run.startedAt).toISOString().slice(0, 10),
    },
  };
}

export function bind(scope: Scope, stepId: string | null, output: unknown): Scope {
  if (!stepId) return scope;
  return { ...scope, [stepId]: { output } };
}
