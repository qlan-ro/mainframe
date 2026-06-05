/**
 * DisplayContent tool-result + tool_call → native content-part mappers.
 *
 * Split out of the projection so the result-shaping logic (structured diff /
 * truncation / AskUserQuestion) lives in one place and is reused by both the
 * top-level assistant message and the subagent transcript.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayContent, ToolCallResult } from '@qlan-ro/mainframe-types';

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];
type ToolCallBlock = DisplayContent & { type: 'tool_call' };

/**
 * Shape a daemon `ToolCallResult` into the value the tool cards consume.
 * Mirrors the desktop card contract: structured-patch object for diffs, a
 * `{content, truncated, fullBytes}` object for truncated output, the
 * `{content, askUserQuestion}` object for AskUserQuestion, else the raw string.
 */
export function mapToolResult(result: ToolCallResult | undefined, toolName: string): unknown {
  if (!result) return undefined;
  if (result.structuredPatch) {
    return {
      content: result.content,
      structuredPatch: result.structuredPatch,
      originalFile: result.originalFile,
      modifiedFile: result.modifiedFile,
      truncated: result.truncated,
      fullBytes: result.fullBytes,
    };
  }
  if (result.truncated) {
    return { content: result.content, truncated: true as const, fullBytes: result.fullBytes ?? 0 };
  }
  if (toolName === 'AskUserQuestion') {
    return { content: result.content, askUserQuestion: result.askUserQuestion };
  }
  return result.content;
}

/** DisplayContent `tool_call` → native ThreadMessageLike `tool-call` part. */
export function mapToolCallPart(block: ToolCallBlock, toolCallId: string): ContentPart {
  return {
    type: 'tool-call',
    toolCallId,
    toolName: block.name,
    args: block.input as import('assistant-stream/utils').ReadonlyJSONObject,
    result: mapToolResult(block.result, block.name),
    isError: block.result?.isError,
  };
}
