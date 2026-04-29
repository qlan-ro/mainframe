// packages/core/src/plugins/builtin/codex/history.ts
import { nanoid } from 'nanoid';
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';
import type { ThreadItem } from './types.js';

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
              name: 'command_execution',
              input: { command: item.command },
            },
          ]),
        );
        messages.push(
          makeMessage(chatId, 'tool_result', [
            {
              type: 'tool_result',
              toolUseId: item.id,
              content: item.aggregatedOutput,
              isError: (item.exitCode ?? 0) !== 0,
            },
          ]),
        );
        break;

      case 'fileChange':
        messages.push(
          makeMessage(chatId, 'assistant', [
            {
              type: 'tool_use',
              id: item.id,
              name: 'file_change',
              input: { changes: item.changes },
            },
          ]),
        );
        messages.push(
          makeMessage(chatId, 'tool_result', [
            {
              type: 'tool_result',
              toolUseId: item.id,
              content: 'applied',
              isError: item.status === 'failed',
            },
          ]),
        );
        break;

      case 'mcpToolCall':
        messages.push(
          makeMessage(chatId, 'assistant', [
            {
              type: 'tool_use',
              id: item.id,
              name: item.tool,
              input: item.arguments,
            },
          ]),
        );
        messages.push(
          makeMessage(chatId, 'tool_result', [
            {
              type: 'tool_result',
              toolUseId: item.id,
              // TODO(F-B.2): simplify — error is now { message: string } | null, string branch is dead
              content: item.error
                ? typeof item.error === 'string'
                  ? item.error
                  : ((item.error as unknown as { message: string }).message ?? '')
                : JSON.stringify(item.result?.content ?? ''),
              isError: !!item.error,
            },
          ]),
        );
        break;

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
