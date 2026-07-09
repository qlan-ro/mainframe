import {
  type ToolCategories,
  isExploreTool,
  isHiddenToolPart,
  isTaskProgressTool,
  isSubagentTool,
} from './tool-categorization.js';

export interface ToolGroupItem {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
  parentToolUseId?: string;
}

export interface TaskProgressItem {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
  parentToolUseId?: string;
}

/** Consecutive explore tools collapsed into one expandable group card. */
export interface ToolGroupEntry {
  type: '_tool_group';
  toolCallId: string;
  items: ToolGroupItem[];
  result: 'grouped';
  parentToolUseId?: string;
}

/** A subagent (Task) tool plus every part tagged with its tool_use id. */
export interface TaskGroupEntry {
  type: '_task_group';
  toolCallId: string;
  taskArgs: Record<string, unknown>;
  children: PartEntry[];
  result?: unknown;
  isError?: boolean;
  parentToolUseId?: string;
}

/** Task-progress tools accumulated into one progress feed entry per parent. */
export interface TaskProgressEntry {
  type: '_task_progress';
  toolCallId: string;
  items: TaskProgressItem[];
  result: 'accumulated';
  parentToolUseId?: string;
}

export type PartEntry =
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
      isError?: boolean;
      category?: string;
      parentToolUseId?: string;
    }
  | { type: 'text'; text: string; parentToolUseId?: string }
  | { type: 'passthrough'; content: import('@qlan-ro/mainframe-types').DisplayContent; parentToolUseId?: string }
  | ToolGroupEntry
  | TaskGroupEntry
  | TaskProgressEntry;

/**
 * Post-processes parts to group consecutive explore tools, suppress hidden tools,
 * and accumulate task progress tools into one _TaskProgress entry per parent.
 * Categories are adapter-declared — pass the adapter's ToolCategories instance.
 */
export function groupToolCallParts(parts: PartEntry[], categories: ToolCategories): PartEntry[] {
  const result: PartEntry[] = [];
  // Progress tools accumulate per parentToolUseId (undefined = main agent), so
  // a subagent's progress feed stays single-parented and can nest inside its
  // task group instead of merging with the main agent's into one mixed entry.
  const progressBuckets = new Map<string | undefined, ProgressBucket>();
  let i = 0;

  // Accumulate a progress tool into its parent's bucket, anchoring the bucket's
  // insert position at the first one seen. Shared by the main loop and the
  // explore look-ahead so the item schema lives in one place.
  const collectTaskItem = (p: Extract<PartEntry, { type: 'tool-call' }>): void => {
    let bucket = progressBuckets.get(p.parentToolUseId);
    if (!bucket) {
      bucket = { insertIndex: result.length, items: [] };
      progressBuckets.set(p.parentToolUseId, bucket);
    }
    bucket.items.push({
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      args: p.args,
      result: p.result,
      isError: p.isError,
      ...(p.parentToolUseId && { parentToolUseId: p.parentToolUseId }),
    });
  };

  while (i < parts.length) {
    const part = parts[i]!;

    if (part.type !== 'tool-call') {
      result.push(part);
      i++;
      continue;
    }

    // Collect task progress tools for accumulated display. Checked BEFORE the
    // hidden suppression: adapters mark the V2 task tools as both `hidden` (so
    // they never render as raw tool cards) and `progress` (so they surface as a
    // _TaskProgress entry). Progress must win, or they'd be dropped.
    if (isTaskProgressTool(part.toolName, categories)) {
      collectTaskItem(part);
      i++;
      continue;
    }

    // Skip hidden tools
    if (isHiddenToolPart(part.toolName, part.category, categories)) {
      i++;
      continue;
    }

    if (isExploreTool(part.toolName, categories)) {
      i = collectExploreRun(parts, i, result, categories, collectTaskItem);
      continue;
    }

    // Everything else passes through
    result.push(part);
    i++;
  }

  spliceProgressEntries(result, progressBuckets);
  return result;
}

interface ProgressBucket {
  insertIndex: number;
  items: TaskProgressItem[];
}

/**
 * Collects the run of consecutive explore tools starting at `start` into a
 * `_tool_group` (pushed bare when the run has one member) and returns the index
 * of the first part after the run. A part whose parentToolUseId differs from
 * the run's first tool ends the run, so a subagent's explore burst never merges
 * with the main agent's (or another subagent's) adjacent tools.
 */
function collectExploreRun(
  parts: PartEntry[],
  start: number,
  result: PartEntry[],
  categories: ToolCategories,
  collectTaskItem: (p: Extract<PartEntry, { type: 'tool-call' }>) => void,
): number {
  const first = parts[start] as Extract<PartEntry, { type: 'tool-call' }>;
  const runParent = first.parentToolUseId;
  const group: Array<Extract<PartEntry, { type: 'tool-call' }>> = [first];
  let j = start + 1;
  while (j < parts.length) {
    const next = parts[j]!;
    if (next.type !== 'tool-call') break;
    if (next.parentToolUseId !== runParent) break;
    if (isExploreTool(next.toolName, categories)) {
      group.push(next);
    } else if (isTaskProgressTool(next.toolName, categories)) {
      // A progress tool inside the run is accumulated, not dropped.
      collectTaskItem(next);
    } else if (!isHiddenToolPart(next.toolName, next.category, categories)) {
      break;
    }
    // hidden tools within the run are skipped
    j++;
  }

  if (group.length >= 2) {
    result.push({
      type: '_tool_group',
      toolCallId: first.toolCallId,
      items: group.map((tc) => ({
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        args: tc.args,
        result: tc.result,
        isError: tc.isError,
        ...(tc.parentToolUseId && { parentToolUseId: tc.parentToolUseId }),
      })),
      result: 'grouped',
      ...(runParent && { parentToolUseId: runParent }),
    });
  } else {
    result.push(first);
  }
  return j;
}

/**
 * Splices one `_task_progress` entry per parent bucket into `result`, each at
 * the position where that parent's first progress tool was seen. Ascending
 * insert order with an offset keeps every recorded index valid as earlier
 * splices shift the array.
 */
function spliceProgressEntries(result: PartEntry[], buckets: Map<string | undefined, ProgressBucket>): void {
  const ordered = [...buckets.entries()].sort((a, b) => a[1].insertIndex - b[1].insertIndex);
  let offset = 0;
  for (const [parentId, bucket] of ordered) {
    result.splice(bucket.insertIndex + offset, 0, {
      type: '_task_progress',
      toolCallId: bucket.items[0]!.toolCallId,
      items: bucket.items,
      result: 'accumulated',
      ...(parentId && { parentToolUseId: parentId }),
    });
    offset++;
  }
}

/**
 * Partitions a turn's parts into per-Task buckets: every part tagged with a
 * subagent tool-call's id nests under that Task as a `_task_group` child,
 * regardless of position — parallel Tasks interleave their children, and a
 * Task's children can arrive after unrelated main-agent parts. Untagged parts
 * stay top-level in order. A tag matching no Task in this turn is subagent
 * content whose parent is not visible here (nested-Task grandchildren) — it is
 * dropped, never rendered in the main flow.
 * Categories are adapter-declared — pass the adapter's ToolCategories instance.
 */
export function groupTaskChildren(parts: PartEntry[], categories: ToolCategories): PartEntry[] {
  const groups = new Map<string, TaskGroupEntry>();
  for (const part of parts) {
    if (part.type === 'tool-call' && !part.parentToolUseId && isSubagentTool(part.toolName, categories)) {
      groups.set(part.toolCallId, {
        type: '_task_group',
        toolCallId: part.toolCallId,
        taskArgs: part.args,
        children: [],
        result: part.result,
        isError: part.isError,
      });
    }
  }

  const result: PartEntry[] = [];
  const bareTasks = new Map<string, PartEntry>();
  for (const part of parts) {
    if (part.type === 'tool-call' && !part.parentToolUseId && groups.has(part.toolCallId)) {
      bareTasks.set(part.toolCallId, part);
      result.push(groups.get(part.toolCallId)!);
      continue;
    }
    if (part.parentToolUseId) {
      groups.get(part.parentToolUseId)?.children.push(part);
      continue;
    }
    result.push(part);
  }

  // A Task that gathered no children renders as its original bare tool-call.
  return result.map((p) =>
    p.type === '_task_group' && p.children.length === 0 ? (bareTasks.get(p.toolCallId) ?? p) : p,
  );
}
