/**
 * stampAgentProjectId — todo #234 bullet 4. `AskAgentStep.projectId` drives
 * which project the daemon's `AgentChatPort` creates the worktree/chat in
 * (`packages/core/src/automations/verbs/ask-agent.ts`); left unset, the
 * engine falls back to "the first project in the DB" (`agent-port.ts`),
 * arbitrary and unrelated to where the automation itself lives. Since
 * automations are project-scoped non-configurably (bullet 1) and the step
 * carries no project picker of its own, every `ask_agent` step inherits the
 * automation's own resolved project automatically — `AutomationEditor`
 * `handleSave` runs the whole step tree through this right before saving,
 * overwriting any stale value.
 */
import type { AutomationStep } from '../contract';

export function stampAgentProjectId(steps: AutomationStep[], projectId: string): AutomationStep[] {
  return steps.map((step) => {
    switch (step.kind) {
      case 'ask_agent':
        return { ...step, projectId };
      case 'if':
        return {
          ...step,
          then: stampAgentProjectId(step.then, projectId),
          otherwise: stampAgentProjectId(step.otherwise, projectId),
        };
      case 'repeat':
        return { ...step, steps: stampAgentProjectId(step.steps, projectId) };
      default:
        return step;
    }
  });
}

/**
 * Whether any step in the tree needs a real project to run (today, only
 * `ask_agent` — its worktree/chat has nowhere else to go). Drives
 * `AutomationEditor`'s one remaining project-related save guard: a draft can
 * go unscoped ("All projects") UNLESS it contains one of these, mirroring the
 * same recursion `stampAgentProjectId` already walks.
 */
export function stepsNeedProject(steps: AutomationStep[]): boolean {
  return steps.some((step) => {
    switch (step.kind) {
      case 'ask_agent':
        return true;
      case 'if':
        return stepsNeedProject(step.then) || stepsNeedProject(step.otherwise);
      case 'repeat':
        return stepsNeedProject(step.steps);
      default:
        return false;
    }
  });
}
