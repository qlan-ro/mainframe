/** Splits a turn's units into steps, markers and the answer, and reads how its steps went. Pure. */
import { callFacts } from '@/features/workspace-chat/agent-status';
import { parseDelegateResult } from '../../orchestration/delegate-result';
import { resolveResultText } from '../../tools/shared/result';
import { parseWorkflowLaunch } from '../../workflow/workflow-progress';
import { isChildWork, isMarkerTool, toolKind } from './tool-kind';
import { settledStatus, wasCancelled } from './tool-status';
import { launchedOnly, retryKey } from './tool-values';
import { isMarkerUnit, isTextUnit } from './turn-units';
import type { ToolPart, Turn, TurnChild, TurnUnit } from './types';

const isTool = (part: TurnUnit['part']): part is ToolPart => part.type === 'tool-call';

/** The turn's steps as tool calls, markers left out. */
export function workTools(units: readonly TurnUnit[]): ToolPart[] {
  return units.flatMap(({ part }) => (isTool(part) && !isMarkerTool(part.toolName) ? [part] : []));
}

/**
 * The answer: while the turn runs, the text after its last step; once it has
 * ended, its last run of text, whatever the agent still did after it. Markers
 * are not steps and never turn text into one.
 */
export function answerUnits(units: readonly TurnUnit[], running: boolean): ReadonlySet<TurnUnit> {
  const visible = units.filter((unit) => !isMarkerUnit(unit));
  let end = visible.length - 1;
  if (!running) while (end >= 0 && !isTextUnit(visible[end]!)) end--;
  const answer = new Set<TurnUnit>();
  while (end >= 0 && isTextUnit(visible[end]!)) answer.add(visible[end--]!);
  // A turn that only called image tools, say, has no text to answer with.
  return [...answer].some((unit) => unit.part.type === 'text') || running ? answer : new Set();
}

/**
 * A failed step is retried when a later step made the same call and it succeeded
 * (T1b). One that only started in the background proves nothing.
 */
export function failedSteps(tools: readonly ToolPart[], pending: ReadonlySet<string>, live: boolean) {
  const recovered = new Set<string>();
  const failed: string[] = [];
  const retried: string[] = [];
  const settledSteps: Turn['settledSteps'][number][] = [];
  for (let index = tools.length - 1; index >= 0; index--) {
    const tool = tools[index]!;
    const status = settledStatus(tool, pending, live);
    const succeeded = status === 'success' && !launchedOnly(tool);
    if (succeeded) recovered.add(retryKey(tool));
    else if (status === 'failed') (recovered.has(retryKey(tool)) ? retried : failed).unshift(tool.toolCallId);
    if (succeeded || status === 'failed' || isChildWork(tool.toolName)) {
      settledSteps.push({ id: tool.toolCallId, succeeded });
    }
  }
  return { failed, retried, settledSteps };
}

/**
 * Whether nothing says how a step ended. A sub-agent's call is left out: what the
 * daemon lists of it says so too (`live-children`).
 */
export function hasUnknownStep(work: readonly TurnUnit[], pending: ReadonlySet<string>, live: boolean): boolean {
  return work.some(
    (unit) =>
      isTool(unit.part) &&
      toolKind(unit.part.toolName) !== 'subagent' &&
      settledStatus(unit.part, pending, live, wasCancelled(unit, false)) === 'unknown',
  );
}

/** A sub-agent waits on the viewer when any call in its own transcript does. */
export function nestedPending(part: ToolPart, pending: ReadonlySet<string>): boolean {
  return (part.messages ?? []).some((message) =>
    message.content.some(
      (entry) =>
        entry.type === 'tool-call' && (pending.has(entry.toolCallId) || nestedPending(entry as ToolPart, pending)),
    ),
  );
}

function childOf(tool: ToolPart, pending: ReadonlySet<string>, live: boolean): TurnChild {
  const status = nestedPending(tool, pending) ? 'awaiting-approval' : settledStatus(tool, pending, live);
  const kind = toolKind(tool.toolName);
  const base = { toolCallId: tool.toolCallId, kind: kind === 'workflow' ? 'workflow' : 'agent', status } as const;
  const text = resolveResultText(tool.result).text;
  if (kind === 'workflow') return { ...base, workflowTaskId: parseWorkflowLaunch(text).taskId };
  if (kind === 'delegate') {
    const launch = parseDelegateResult(text);
    return { ...base, taskChatId: launch?.childChatId, taskId: launch?.taskId, taskStatus: launch?.status };
  }
  return { ...base, call: callFacts({ part: tool, messageId: '' }, pending) };
}

export function turnChildren(tools: readonly ToolPart[], pending: ReadonlySet<string>, live: boolean): TurnChild[] {
  return tools.filter((tool) => isChildWork(tool.toolName)).map((tool) => childOf(tool, pending, live));
}
