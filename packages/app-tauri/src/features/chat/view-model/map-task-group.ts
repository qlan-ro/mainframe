/**
 * Maps a task_group DisplayContent block → the _TaskGroup tool-call part.
 *
 * Extracted from convert-message.ts to keep each file under 300 lines.
 * WS14c dual re-encode: tool_group and task_progress nested inside
 * task_group.calls are re-encoded to _ToolGroup / _TaskProgress so the
 * TaskGroupCard renderer can display subagent work.
 */
import type { DisplayContent } from '@qlan-ro/mainframe-types';

type TaskGroupChild =
  | { kind: 'tool'; toolCallId: string; toolName: string; args: unknown; result: unknown; isError?: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; thinking: string }
  | { kind: 'skill_loaded'; skillName: string; path: string; content: string }
  | { kind: 'image'; mediaType: string; data: string };

export function mapTaskGroupChild(c: DisplayContent): TaskGroupChild | null {
  if (c.type === 'tool_call') {
    return {
      kind: 'tool',
      toolCallId: c.id,
      toolName: c.name,
      args: c.input,
      result: c.result,
      isError: c.result?.isError,
    };
  }
  if (c.type === 'text') return { kind: 'text', text: c.text };
  if (c.type === 'thinking') return { kind: 'thinking', thinking: c.thinking };
  if (c.type === 'skill_loaded') {
    return { kind: 'skill_loaded', skillName: c.skillName, path: c.path, content: c.content };
  }
  if (c.type === 'image') return { kind: 'image', mediaType: c.mediaType, data: c.data };

  // WS14c nested re-encode: tool_group inside task_group.calls
  if (c.type === 'tool_group') {
    const groupCalls = c.calls.filter((g): g is DisplayContent & { type: 'tool_call' } => g.type === 'tool_call');
    return {
      kind: 'tool',
      toolCallId: groupCalls[0]?.id ?? '',
      toolName: '_ToolGroup',
      args: {
        items: groupCalls.map((g) => ({
          toolCallId: g.id,
          toolName: g.name,
          args: g.input,
          result: g.result,
          isError: g.result?.isError,
        })),
      },
      result: 'grouped',
    };
  }

  // WS14c nested re-encode: task_progress inside task_group.calls
  if (c.type === 'task_progress') {
    return {
      kind: 'tool',
      toolCallId: c.items[0]?.id ?? '',
      toolName: '_TaskProgress',
      args: {
        items: c.items.map((item) => ({
          toolCallId: item.id,
          toolName: item.name,
          args: item.input,
          result: item.result,
          isError: item.result?.isError,
        })),
      },
      result: 'accumulated',
    };
  }

  return null;
}
