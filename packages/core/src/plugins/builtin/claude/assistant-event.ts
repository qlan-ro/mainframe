import { resolveSkillPath } from './skill-path.js';
import type { MessageContent, SessionSink } from '@qlan-ro/mainframe-types';
import type { ClaudeSession } from './session.js';
import { isPrCreateCommand, isPrMutationCommand, parsePrIdentifierFromArgs } from './pr-detection.js';
import { normalizeTodos } from '../../../todos/normalize.js';

export function handleAssistantEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  const message = event.message as {
    model?: string;
    content: MessageContent[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  if (message?.usage) {
    session.state.lastAssistantUsage = message.usage;
  }
  if (!message?.content) return;

  if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
    const parentToolUseId = event.parent_tool_use_id;
    const tagged = message.content.map((b) => ({
      ...b,
      parentToolUseId,
    })) as import('@qlan-ro/mainframe-types').MessageContent[];
    sink.onSubagentChild(parentToolUseId, tagged);
    return;
  }

  for (const block of message.content) {
    if (block.type === 'tool_use') {
      if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: unknown[] };
        if (Array.isArray(input?.todos)) {
          const valid = input.todos.filter(
            (t): t is import('@qlan-ro/mainframe-types').TodoItem =>
              typeof t === 'object' &&
              t !== null &&
              typeof (t as Record<string, unknown>).content === 'string' &&
              typeof (t as Record<string, unknown>).status === 'string',
          );
          if (valid.length > 0) sink.onTodoUpdate(valid);
        }
      }
      const taskV2Name = block.name as string;
      if (taskV2Name === 'TaskCreate' || taskV2Name === 'TaskUpdate' || taskV2Name === 'TaskStop') {
        handleTaskV2Event(session, taskV2Name as 'TaskCreate' | 'TaskUpdate' | 'TaskStop', block.input, sink);
      }
      const name = block.name as string;
      const id = block.id as string | undefined;
      if (id && name) {
        const command = (block.input as { command?: string } | undefined)?.command;
        session.state.toolUseRegistry.set(id, command ? { name, command } : { name });
        if (session.state.mainframeChatId) {
          session.state.taskEvents.captureToolUse(id, {
            name: block.name,
            input: block.input as { command?: string; description?: string; run_in_background?: boolean } | undefined,
          });
        }
      }
      if (name === 'Bash' || name === 'BashTool') {
        const input = block.input as { command?: string } | undefined;
        if (input?.command && isPrCreateCommand(input.command)) {
          session.state.pendingPrCreates.add(block.id as string);
        }
        if (input?.command && isPrMutationCommand(input.command)) {
          const pr = parsePrIdentifierFromArgs(input.command);
          if (pr) session.state.pendingPrMutations.set(block.id as string, pr);
        }
      }
      if (name === 'Skill') {
        const input = block.input as { skill?: string } | undefined;
        const skillName = input?.skill?.trim();
        if (skillName) {
          // Use the cached path from a prior user-event (more accurate), falling back to the probe.
          const cachedPath = session.state.skillPathCache.get(skillName);
          const resolvedPath =
            cachedPath ?? resolveSkillPath(session.projectPath, skillName, session.state.skillPathCache);
          sink.onSkillFile({ path: resolvedPath, displayName: skillName });
        }
      }
    }
  }

  sink.onMessage(message.content, {
    model: message.model,
    usage: message.usage,
  });
}

/**
 * Handle a V2 task event (TaskCreate/TaskUpdate/TaskStop), accumulating state
 * on the session and emitting onTodoUpdate with the current snapshot.
 */
function handleTaskV2Event(
  session: ClaudeSession,
  toolName: 'TaskCreate' | 'TaskUpdate' | 'TaskStop',
  input: Record<string, unknown>,
  sink: SessionSink,
): void {
  session.state.taskV2Events.push({ toolName, args: input });
  const todos = normalizeTodos('taskV2', session.state.taskV2Events);
  if (todos.length > 0) sink.onTodoUpdate(todos);
}
