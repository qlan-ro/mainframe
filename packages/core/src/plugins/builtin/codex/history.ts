// packages/core/src/plugins/builtin/codex/history.ts
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import type { ThreadItem, PatchChangeKind } from './types.js';
import type { CollabAgentToolCallItem } from './item-types.js';
import { parseUnifiedDiff } from '../../../messages/parse-unified-diff.js';

export function convertThreadItems(
  items: ThreadItem[],
  chatId: string,
  childItemsByThread: Map<string, ThreadItem[]> = new Map(),
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Stash spawnAgent prompts (keyed by child thread id) so the matching `wait`
  // item can use them as the TaskGroup card's description.
  const spawnPrompts = new Map<string, string>();

  for (const item of items) {
    switch (item.type) {
      case 'agentMessage':
        messages.push(makeMessage(chatId, 'assistant', [{ type: 'text', text: item.text }]));
        break;

      case 'reasoning':
        messages.push(
          makeMessage(chatId, 'assistant', [
            { type: 'thinking', thinking: item.summary.join('\n') || item.content.join('\n') },
          ]),
        );
        break;

      case 'commandExecution':
        messages.push(
          makeMessage(chatId, 'assistant', [
            {
              type: 'tool_use',
              id: item.id,
              name: 'Bash',
              input: { command: item.command },
            },
          ]),
        );
        messages.push(
          makeMessage(chatId, 'tool_result', [
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
          messages.push(makeMessage(chatId, 'assistant', [{ type: 'tool_use', id: toolId, name: toolName, input }]));
          messages.push(
            makeMessage(chatId, 'tool_result', [
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
          makeMessage(chatId, 'assistant', [
            {
              type: 'tool_use',
              id: item.id,
              name: toolName,
              input: item.arguments,
            },
          ]),
        );
        messages.push(
          makeMessage(chatId, 'tool_result', [
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
        const text = item.content?.find((b) => b.type === 'text')?.text ?? item.text ?? '';
        if (!text) break;
        messages.push(makeMessage(chatId, 'user', [{ type: 'text', text }]));
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
        emitCollabAgent(messages, chatId, item, spawnPrompts, childItemsByThread);
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
): void {
  const isError = item.status === 'failed' || item.status === 'interrupted';
  const childId = item.receiverThreadIds?.[0];
  const description = (childId && spawnPrompts.get(childId)) ?? item.prompt ?? 'Sub-agent';
  const subAgentMessage = childId ? (item.agentsStates?.[childId]?.message ?? null) : null;

  // Build the parent assistant message: CollabAgent tool_use first, then sub-agent
  // child items inlined as content blocks (tagged with parentToolUseId so the desktop's
  // groupTaskChildren() promotes the parent into a TaskGroup card). Children must live
  // in the SAME assistant message — see claude/history.ts injectAgentChildren for the
  // pattern reference.
  const content: MessageContent[] = [
    {
      type: 'tool_use',
      id: item.id,
      name: 'CollabAgent',
      input: { prompt: description, description },
    },
  ];

  if (childId) {
    const childItems = childItemsByThread.get(childId);
    if (childItems && childItems.length > 0) {
      const childMessages = convertThreadItems(childItems, chatId, childItemsByThread);
      for (const m of childMessages) {
        // Skip the child thread's user-prompt echo — it's just a copy of the spawn prompt.
        if (m.type === 'user') continue;
        for (const block of m.content) {
          content.push({ ...block, parentToolUseId: item.id });
        }
      }
    }
  }

  messages.push(makeMessage(chatId, 'assistant', content));
  // Close the card with a separate tool_result message (matches the live event-mapper path).
  messages.push(
    makeMessage(chatId, 'tool_result', [
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

function makeMessage(chatId: string, type: ChatMessage['type'], content: MessageContent[]): ChatMessage {
  return {
    id: nanoid(),
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
