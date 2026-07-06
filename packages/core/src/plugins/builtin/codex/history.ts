// packages/core/src/plugins/builtin/codex/history.ts
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import type { ThreadItem, PatchChangeKind } from './types.js';
import type { CollabAgentToolCallItem } from './item-types.js';
import { parseUnifiedDiff } from '../../../messages/parse-unified-diff.js';
import { describeAgent, agentTitle, type AgentMetadata } from './thread-registry.js';

export function convertThreadItems(
  items: ThreadItem[],
  chatId: string,
  childItemsByThread: Map<string, ThreadItem[]> = new Map(),
  agentMetaByThread: Map<string, AgentMetadata> = new Map(),
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Stash spawnAgent prompts (keyed by child thread id) so the matching `wait`
  // item can use them as the TaskGroup card's description.
  const spawnPrompts = new Map<string, string>();

  for (const item of items) {
    switch (item.type) {
      case 'agentMessage':
        messages.push(makeMessage(item.id, chatId, 'assistant', [{ type: 'text', text: item.text }]));
        break;

      case 'reasoning':
        messages.push(
          makeMessage(item.id, chatId, 'assistant', [
            { type: 'thinking', thinking: item.summary.join('\n') || item.content.join('\n') },
          ]),
        );
        break;

      case 'commandExecution':
        messages.push(
          makeMessage(item.id, chatId, 'assistant', [
            {
              type: 'tool_use',
              id: item.id,
              name: 'Bash',
              input: { command: item.command },
            },
          ]),
        );
        messages.push(
          makeMessage(`${item.id}:result`, chatId, 'tool_result', [
            {
              type: 'tool_result',
              toolUseId: item.id,
              content: item.aggregatedOutput ?? '',
              isError: item.exitCode !== undefined && item.exitCode !== 0,
            },
          ]),
        );
        break;

      case 'fileChange': {
        const isError = item.status === 'failed' || item.status === 'declined';
        for (const [index, change] of item.changes.entries()) {
          const toolId = `${item.id}:${index}`;
          const isAdd = change.kind.type === 'add';
          const toolName = isAdd ? 'Write' : 'Edit';
          const structuredPatch = parseUnifiedDiff(change.diff);
          const input: Record<string, unknown> = isAdd
            ? { file_path: change.path, content: extractAddedContent(change.diff) }
            : {
                file_path: change.path,
                old_string: '',
                new_string: '',
                ...((change.kind as Extract<PatchChangeKind, { type: 'update' }>).move_path != null
                  ? { move_path: (change.kind as Extract<PatchChangeKind, { type: 'update' }>).move_path }
                  : {}),
              };
          messages.push(
            makeMessage(toolId, chatId, 'assistant', [{ type: 'tool_use', id: toolId, name: toolName, input }]),
          );
          messages.push(
            makeMessage(`${toolId}:result`, chatId, 'tool_result', [
              {
                type: 'tool_result',
                toolUseId: toolId,
                content: 'OK',
                isError,
                ...(structuredPatch.length ? { structuredPatch } : {}),
              },
            ]),
          );
        }
        break;
      }

      case 'mcpToolCall': {
        const server = item.server ?? 'codex';
        const toolName = `mcp__${server}__${item.tool}`;
        messages.push(
          makeMessage(item.id, chatId, 'assistant', [
            {
              type: 'tool_use',
              id: item.id,
              name: toolName,
              input: item.arguments,
            },
          ]),
        );
        messages.push(
          makeMessage(`${item.id}:result`, chatId, 'tool_result', [
            {
              type: 'tool_result',
              toolUseId: item.id,
              content: item.error ? (item.error.message ?? '') : JSON.stringify(item.result?.content ?? ''),
              isError: !!item.error,
            },
          ]),
        );
        break;
      }

      case 'userMessage': {
        // Codex's `thread/read` returns `content: [{ type: 'text', text: '...' }]`.
        // Rollout JSONL records use `input_text` instead. Accept either, plus the
        // legacy top-level `item.text` field, so the same reader handles both shapes.
        const block = item.content?.find((b) => typeof b.text === 'string' && b.text.length > 0);
        const text = block?.text ?? item.text ?? '';
        if (!text) break;
        messages.push(makeMessage(item.id, chatId, 'user', [{ type: 'text', text }]));
        break;
      }

      case 'collabAgentToolCall': {
        // `spawnAgent` is dispatch metadata only — stash its prompt for the `wait` card.
        if (item.tool === 'spawnAgent') {
          for (const childId of item.receiverThreadIds ?? []) {
            if (item.prompt) spawnPrompts.set(childId, item.prompt);
          }
          break;
        }
        // `wait` renders the TaskGroup card with sub-agent's child items nested under it.
        emitCollabAgent(messages, chatId, item, spawnPrompts, childItemsByThread, agentMetaByThread);
        break;
      }

      // webSearch, todoList — skip for now
    }
  }

  return messages;
}

function emitCollabAgent(
  messages: ChatMessage[],
  chatId: string,
  item: CollabAgentToolCallItem,
  spawnPrompts: Map<string, string>,
  childItemsByThread: Map<string, ThreadItem[]>,
  agentMetaByThread: Map<string, AgentMetadata>,
): void {
  const isError = item.status === 'failed' || item.status === 'interrupted';
  const childId = item.receiverThreadIds?.[0];
  // Pull the agent's identity from Codex's thread DB:
  //   - subagent_type = nickname (e.g. "Maxwell") — bold card title, like Claude's
  //   - description   = the spawn prompt (the task) — informative subtitle, truncated
  //                     to 60 chars in the card with full text in a tooltip
  // If nickname is missing, fall back to role ("explorer") for the title.
  const meta = childId ? agentMetaByThread.get(childId) : undefined;
  const subagentType = agentTitle(meta) ?? describeAgent(meta) ?? 'Sub-agent';
  const prompt = (childId && spawnPrompts.get(childId)) ?? item.prompt ?? '';
  // Description is the agent's role (e.g. "explorer") — short subtitle next to the
  // nickname title. The full prompt is visible when the user expands the card.
  const description = describeAgent(meta) ?? (prompt || subagentType);
  const subAgentMessage = childId ? (item.agentsStates?.[childId]?.message ?? null) : null;

  // Build the parent assistant message: CollabAgent tool_use first, then sub-agent
  // child *non-result* blocks (tool_use, text, thinking) tagged with parentToolUseId so
  // the desktop's groupTaskChildren() nests them under it.
  //
  // Sub-agent tool_result blocks are NOT inlined here. groupMessages only attaches
  // results coming from separate `tool_result`-type messages — inlining them would lose
  // the bash output. We emit them as standalone tool_result messages right after the
  // parent so they get attached via toolUseId.
  const content: MessageContent[] = [
    {
      type: 'tool_use',
      id: item.id,
      name: 'CollabAgent',
      input: { prompt, description, subagent_type: subagentType },
    },
  ];
  const childToolResults: Array<MessageContent & { type: 'tool_result' }> = [];

  if (childId) {
    const childItems = childItemsByThread.get(childId);
    if (childItems && childItems.length > 0) {
      const childMessages = convertThreadItems(childItems, chatId, childItemsByThread);
      for (const m of childMessages) {
        // Skip the child thread's user-prompt echo — it's just a copy of the spawn prompt.
        if (m.type === 'user') continue;
        for (const block of m.content) {
          if (block.type === 'tool_result') {
            childToolResults.push({ ...block, parentToolUseId: item.id });
          } else {
            content.push({ ...block, parentToolUseId: item.id });
          }
        }
      }
    }
  }

  messages.push(makeMessage(item.id, chatId, 'assistant', content));
  for (const [index, r] of childToolResults.entries()) {
    messages.push(makeMessage(`${item.id}:child:${index}:result`, chatId, 'tool_result', [r]));
  }
  // Close the card with the CollabAgent's own tool_result (sub-agent's final message).
  messages.push(
    makeMessage(`${item.id}:result`, chatId, 'tool_result', [
      {
        type: 'tool_result',
        toolUseId: item.id,
        content: subAgentMessage ?? 'Sub-agent completed',
        isError,
      },
    ]),
  );
  if (childId) spawnPrompts.delete(childId);
}

/**
 * Build a ChatMessage with a CALLER-SUPPLIED deterministic id. The id is derived
 * from the Codex thread item's stable `id` (+ a slot suffix for items that emit
 * more than one message), so reconstructing the same items yields the same ids
 * every turn. That lets the display delta emitter detect appends/updates instead
 * of re-broadcasting the whole list (a `display.messages.set`) on every turn —
 * which previously happened because `id: nanoid()` changed the ids each pass.
 */
function makeMessage(id: string, chatId: string, type: ChatMessage['type'], content: MessageContent[]): ChatMessage {
  return {
    id,
    chatId,
    type,
    content,
    timestamp: new Date().toISOString(),
  };
}

function extractAddedContent(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}
