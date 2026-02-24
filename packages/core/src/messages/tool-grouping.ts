import {
  type ToolCategories,
  isExploreTool,
  isHiddenTool,
  isTaskProgressTool,
  isSubagentTool,
} from './tool-categorization.js';

export interface ToolGroupItem {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
}

export interface TaskProgressItem {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean | undefined;
}

export type PartEntry =
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
      isError?: boolean;
    }
  | { type: 'text'; text: string };

/**
 * Post-processes parts to group consecutive explore tools, suppress hidden tools,
 * and accumulate task progress tools into a single _TaskProgress entry.
 * Categories are adapter-declared — pass the adapter's ToolCategories instance.
 */
export function groupToolCallParts(parts: PartEntry[], categories: ToolCategories): PartEntry[] {
  const result: PartEntry[] = [];
  const taskItems: TaskProgressItem[] = [];
  let taskInsertIndex = -1;
  let i = 0;

  while (i < parts.length) {
    const part = parts[i]!;

    if (part.type !== 'tool-call') {
      result.push(part);
      i++;
      continue;
    }

    // Skip hidden tools
    if (isHiddenTool(part.toolName, categories)) {
      i++;
      continue;
    }

    // Collect task progress tools for accumulated display
    if (isTaskProgressTool(part.toolName, categories)) {
      if (taskInsertIndex === -1) taskInsertIndex = result.length;
      taskItems.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        result: part.result,
        isError: part.isError,
      });
      i++;
      continue;
    }

    // Collect consecutive explore tools into a group
    if (isExploreTool(part.toolName, categories)) {
      const group: PartEntry[] = [part];
      let j = i + 1;
      while (j < parts.length) {
        const next = parts[j]!;
        if (next.type !== 'tool-call') break;
        if (isExploreTool(next.toolName, categories)) {
          group.push(next);
        } else if (!isHiddenTool(next.toolName, categories) && !isTaskProgressTool(next.toolName, categories)) {
          break;
        }
        // hidden and task tools within the run are skipped/collected separately
        j++;
      }

      if (group.length >= 2) {
        const items: ToolGroupItem[] = group.map((g) => {
          const tc = g as PartEntry & { type: 'tool-call' };
          return {
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            args: tc.args,
            result: tc.result,
            isError: tc.isError,
          };
        });
        result.push({
          type: 'tool-call',
          toolCallId: (group[0] as PartEntry & { type: 'tool-call' }).toolCallId,
          toolName: '_ToolGroup',
          args: { items },
          result: 'grouped',
        });
      } else {
        result.push(group[0]!);
      }
      i = j;
      continue;
    }

    // Everything else passes through
    result.push(part);
    i++;
  }

  // Insert accumulated task progress at the position of the first task tool
  if (taskItems.length > 0) {
    const entry: PartEntry = {
      type: 'tool-call',
      toolCallId: taskItems[0]!.toolCallId,
      toolName: '_TaskProgress',
      args: { items: taskItems },
      result: 'accumulated',
    };
    result.splice(taskInsertIndex >= 0 ? taskInsertIndex : result.length, 0, entry);
  }

  return result;
}

/**
 * Wraps a subagent tool call together with all subsequent tool calls (until the next
 * text block or another subagent call) into a single _TaskGroup virtual entry so they
 * render nested under the subagent header.
 * Categories are adapter-declared — pass the adapter's ToolCategories instance.
 */
export function groupTaskChildren(parts: PartEntry[], categories: ToolCategories): PartEntry[] {
  const result: PartEntry[] = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i]!;

    if (part.type === 'tool-call' && isSubagentTool(part.toolName, categories)) {
      const children: PartEntry[] = [];
      let j = i + 1;
      while (j < parts.length) {
        const next = parts[j]!;
        if (next.type === 'text') break;
        if (next.type === 'tool-call' && isSubagentTool(next.toolName, categories)) break;
        children.push(next);
        j++;
      }

      if (children.length > 0) {
        result.push({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: '_TaskGroup',
          args: { taskArgs: part.args, children },
          result: part.result,
          isError: part.isError,
        });
        i = j;
      } else {
        result.push(part);
        i++;
      }
    } else {
      result.push(part);
      i++;
    }
  }

  return result;
}
