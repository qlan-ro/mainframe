import type { WorkflowDef } from '../dsl/types.js';

export interface EventTriggerBinding {
  workflowId: string;
  definition: WorkflowDef;
  /** Daemon event type to listen for, e.g. 'workflow.completed' or 'chat.updated'. */
  on: string;
  /** For 'workflow.completed' events: only fire when the source workflow name matches. */
  workflowFilter?: string;
}

/**
 * Filter the binding list to those whose trigger matches the incoming event.
 * The daemon bus subscription and run-creation live in the WorkflowService wiring (Task 17).
 */
export function matchEventTriggers(
  bindings: EventTriggerBinding[],
  eventType: string,
  payload: Record<string, unknown>,
): EventTriggerBinding[] {
  return bindings.filter((b) => {
    if (b.on !== eventType) return false;
    if (b.workflowFilter !== undefined && payload['workflowName'] !== b.workflowFilter) return false;
    return true;
  });
}
