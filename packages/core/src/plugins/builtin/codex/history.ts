// packages/core/src/plugins/builtin/codex/history.ts
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import type { ThreadItem, PatchChangeKind } from './types.js';
import { parseUnifiedDiff } from '../../../messages/parse-unified-diff.js';

export function convertThreadItems(items: ThreadItem[], chatId: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

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

      case 'userMessage':
        messages.push(makeMessage(chatId, 'user', [{ type: 'text', text: item.text }]));
        break;

      // webSearch, todoList — skip for now
    }
  }

  return messages;
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
