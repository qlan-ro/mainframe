// TODO: Replace `any` SDK message types with imports from @anthropic-ai/claude-agent-sdk
// once we're confident the SDK type contract is stable. Currently using `any` to avoid
// tight coupling to SDK internals during initial integration.
import type { MessageContent, SessionSink, MessageMetadata, SessionResult } from '@qlan-ro/mainframe-types';

export function mapSdkMessage(msg: any, sink: SessionSink): void {
  switch (msg.type) {
    case 'system':
      mapSystemMessage(msg, sink);
      break;
    case 'assistant':
      mapAssistantMessage(msg, sink);
      break;
    case 'user':
      mapUserMessage(msg, sink);
      break;
    case 'result':
      mapResultMessage(msg, sink);
      break;
  }
}

function mapSystemMessage(msg: any, sink: SessionSink): void {
  switch (msg.subtype) {
    case 'init':
      sink.onInit(msg.session_id);
      break;
    case 'compact_boundary':
      sink.onCompact();
      break;
  }
}

function mapAssistantMessage(msg: any, sink: SessionSink): void {
  const message = msg.message;
  if (!message?.content) return;

  const content: MessageContent[] = [];
  for (const block of message.content) {
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

  const metadata: MessageMetadata = {};
  if (message.model) metadata.model = message.model;
  if (message.usage) {
    metadata.usage = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
    };
  }

  sink.onMessage(content, metadata);
}

function mapUserMessage(msg: any, sink: SessionSink): void {
  const message = msg.message;
  if (!message?.content || typeof message.content === 'string') return;

  const toolResults: MessageContent[] = [];
  for (const block of message.content) {
    if (block.type !== 'tool_result') continue;
    const contentStr = Array.isArray(block.content)
      ? block.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('')
      : typeof block.content === 'string'
        ? block.content
        : '';

    toolResults.push({
      type: 'tool_result',
      toolUseId: block.tool_use_id,
      content: contentStr,
      isError: block.is_error ?? false,
    });

    detectPlanFiles(contentStr, sink);
    detectSkillFiles(contentStr, sink);
  }

  if (toolResults.length > 0) {
    sink.onToolResult(toolResults);
  }
}

function detectPlanFiles(content: string, sink: SessionSink): void {
  const planMatch = content.match(/"filePath"\s*:\s*"([^"]+)"/);
  if (planMatch?.[1]) {
    sink.onPlanFile(planMatch[1]);
  }
}

function detectSkillFiles(content: string, sink: SessionSink): void {
  const skillMatch = content.match(/Base directory for this skill:\s*(.+)/);
  if (skillMatch?.[1]) {
    const path = skillMatch[1].trim();
    const displayName = path.split('/').pop() ?? path;
    sink.onSkillFile({ path, displayName });
  }
}

function mapResultMessage(msg: any, sink: SessionSink): void {
  const data: SessionResult = {
    total_cost_usd: msg.total_cost_usd,
    usage: msg.usage
      ? {
          input_tokens: msg.usage.input_tokens,
          output_tokens: msg.usage.output_tokens,
          cache_creation_input_tokens: msg.usage.cache_creation_input_tokens,
          cache_read_input_tokens: msg.usage.cache_read_input_tokens,
        }
      : undefined,
    subtype: msg.subtype,
    result: msg.result,
    is_error: msg.is_error,
  };
  sink.onResult(data);
}
