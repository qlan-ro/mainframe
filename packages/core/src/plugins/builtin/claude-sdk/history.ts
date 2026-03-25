// TODO: Replace `any` SDK message types with imports from @anthropic-ai/claude-agent-sdk
// once the SDK type contract stabilizes.
import type { ChatMessage, MessageContent } from '@qlan-ro/mainframe-types';

export function convertSessionMessages(messages: any[], chatId: string): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    const converted = convertMessage(msg, chatId);
    if (converted) result.push(converted);
  }

  return result;
}

function convertMessage(msg: any, chatId: string): ChatMessage | null {
  switch (msg.type) {
    case 'assistant':
      return convertAssistant(msg, chatId);
    case 'user':
      return convertUser(msg, chatId);
    default:
      return null;
  }
}

function convertAssistant(msg: any, chatId: string): ChatMessage | null {
  const rawContent = msg.message?.content;
  if (!rawContent || (Array.isArray(rawContent) && rawContent.length === 0)) return null;

  const content: MessageContent[] = [];
  for (const block of rawContent) {
    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text });
        break;
      case 'tool_use':
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        break;
      case 'thinking':
        content.push({ type: 'thinking', thinking: block.thinking });
        break;
    }
  }

  if (content.length === 0) return null;

  return {
    id: msg.uuid,
    chatId,
    type: 'assistant',
    content,
    timestamp: msg.timestamp ?? new Date().toISOString(),
    metadata: msg.message?.usage
      ? {
          usage: {
            input_tokens: msg.message.usage.input_tokens,
            output_tokens: msg.message.usage.output_tokens,
          },
        }
      : undefined,
  };
}

function convertUser(msg: any, chatId: string): ChatMessage | null {
  const rawContent = msg.message?.content;
  if (!rawContent) return null;

  if (typeof rawContent === 'string') {
    return {
      id: msg.uuid,
      chatId,
      type: 'user',
      content: [{ type: 'text', text: rawContent }],
      timestamp: msg.timestamp ?? new Date().toISOString(),
    };
  }

  if (!Array.isArray(rawContent)) return null;

  const hasToolResults = rawContent.some((b: any) => b.type === 'tool_result');
  if (hasToolResults) {
    return convertToolResults(msg, chatId, rawContent);
  }

  return convertUserBlocks(msg, chatId, rawContent);
}

function convertToolResults(msg: any, chatId: string, rawContent: any[]): ChatMessage | null {
  const content: MessageContent[] = [];
  for (const block of rawContent) {
    if (block.type !== 'tool_result') continue;
    content.push({
      type: 'tool_result',
      toolUseId: block.tool_use_id,
      content: extractToolResultContent(block),
      isError: block.is_error ?? false,
    });
  }
  if (content.length === 0) return null;
  return {
    id: msg.uuid,
    chatId,
    type: 'tool_result',
    content,
    timestamp: msg.timestamp ?? new Date().toISOString(),
  };
}

function convertUserBlocks(msg: any, chatId: string, rawContent: any[]): ChatMessage | null {
  const content: MessageContent[] = [];
  for (const block of rawContent) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      content.push({
        type: 'image',
        mediaType: block.source?.media_type ?? 'image/png',
        data: block.source?.data ?? '',
      });
    }
  }
  if (content.length === 0) return null;
  return {
    id: msg.uuid,
    chatId,
    type: 'user',
    content,
    timestamp: msg.timestamp ?? new Date().toISOString(),
  };
}

function extractToolResultContent(block: any): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('');
  }
  return '';
}
