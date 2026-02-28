import type { MessageContent, ToolCategories, DisplayContent, ToolCallResult } from '@mainframe/types';
import { stripMainframeCommandTags, parseCommandMessage, parseAttachedFilePathTags } from './message-parsing.js';
import type { GroupedMessage } from './message-grouping.js';
import type { PartEntry } from './tool-grouping.js';
import { groupToolCallParts, groupTaskChildren } from './tool-grouping.js';

const INTERNAL_USER_RE = /<command-name>|<mainframe-command[\s>]/;

/** Returns true if a user message is internal (mainframe commands or skill invocations). */
export function isInternalUserMessage(content: MessageContent[]): boolean {
  return content.some((block) => block.type === 'text' && INTERNAL_USER_RE.test(block.text));
}

/** Categorize a tool by name, returning its display category. */
export function categorizeToolCall(
  name: string,
  categories?: ToolCategories,
): 'default' | 'explore' | 'hidden' | 'progress' | 'subagent' {
  if (!categories) return 'default';
  if (categories.explore.has(name)) return 'explore';
  if (categories.hidden.has(name)) return 'hidden';
  if (categories.progress.has(name)) return 'progress';
  if (categories.subagent.has(name)) return 'subagent';
  return 'default';
}

/** Build a ToolCallResult from a tool_result content block. */
function toToolCallResult(block: MessageContent & { type: 'tool_result' }): ToolCallResult {
  return {
    content: block.content,
    isError: block.isError,
    ...(block.structuredPatch && { structuredPatch: block.structuredPatch }),
    ...(block.originalFile && { originalFile: block.originalFile }),
    ...(block.modifiedFile && { modifiedFile: block.modifiedFile }),
  };
}

/** Convert a grouped assistant message to DisplayContent[]. */
export function convertAssistantContent(grouped: GroupedMessage, categories?: ToolCategories): DisplayContent[] {
  const seenToolIds = new Set<string>();
  const content: DisplayContent[] = [];

  for (const block of grouped.content) {
    if (block.type === 'text') {
      const stripped = stripMainframeCommandTags(block.text);
      if (stripped) content.push({ type: 'text', text: stripped });
    } else if (block.type === 'thinking') {
      content.push({ type: 'thinking', thinking: block.thinking });
    } else if (block.type === 'tool_use') {
      if (seenToolIds.has(block.id)) continue;
      seenToolIds.add(block.id);

      const resultBlock = grouped._toolResults?.get(block.id);
      const call: DisplayContent & { type: 'tool_call' } = {
        type: 'tool_call',
        id: block.id,
        name: block.name,
        input: block.input,
        category: categorizeToolCall(block.name, categories),
      };
      if (resultBlock) call.result = toToolCallResult(resultBlock);
      content.push(call);
    }
  }

  return content;
}

/** Convert a user message's content blocks to DisplayContent[] and extract metadata. */
export function convertUserContent(content: MessageContent[]): {
  displayContent: DisplayContent[];
  metadata: Record<string, unknown>;
} {
  const metadata: Record<string, unknown> = {};
  const displayContent: DisplayContent[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      if (block.text.startsWith('[Request interrupted')) continue;

      const cmdInfo = parseCommandMessage(block.text);
      if (cmdInfo) metadata.command = { name: cmdInfo.commandName, userText: cmdInfo.userText };

      const { files, cleanText } = parseAttachedFilePathTags(block.text);
      if (files.length > 0) metadata.attachedFiles = files;

      const textToStore = files.length > 0 ? cleanText : block.text;
      if (cmdInfo) metadata.cleanText = cmdInfo.userText;

      if (textToStore) displayContent.push({ type: 'text', text: textToStore });
    } else if (block.type === 'image') {
      displayContent.push({ type: 'image', mediaType: block.mediaType, data: block.data });
    }
  }

  return { displayContent, metadata };
}

/** Apply tool grouping (explore groups, task groups, progress accumulation). */
export function applyToolGrouping(content: DisplayContent[], categories: ToolCategories): DisplayContent[] {
  const parts: PartEntry[] = content.map((c) => {
    if (c.type === 'tool_call') {
      return {
        type: 'tool-call' as const,
        toolCallId: c.id,
        toolName: c.name,
        args: c.input,
        result: c.result,
        isError: c.result?.isError,
      };
    }
    if (c.type === 'text') return { type: 'text' as const, text: c.text };
    // Pass non-groupable content through by encoding as a sentinel tool call
    return { type: 'text' as const, text: '' };
  });

  let grouped = groupToolCallParts(parts, categories);
  grouped = groupTaskChildren(grouped, categories);

  return convertGroupedPartsToDisplay(grouped, content, categories);
}

/** Convert PartEntry[] back to DisplayContent[], handling virtual group entries. */
function convertGroupedPartsToDisplay(
  parts: PartEntry[],
  originalContent: DisplayContent[],
  categories: ToolCategories,
): DisplayContent[] {
  const result: DisplayContent[] = [];

  // Re-insert non-text/non-tool_call content (thinking, image, etc.) at the front
  for (const c of originalContent) {
    if (c.type !== 'tool_call' && c.type !== 'text') result.push(c);
  }

  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text) result.push({ type: 'text', text: part.text });
      continue;
    }

    if (part.toolName === '_ToolGroup') {
      const items = part.args.items as Array<{
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
        result: unknown;
        isError: boolean | undefined;
      }>;
      result.push({
        type: 'tool_group',
        calls: items.map((item) => ({
          type: 'tool_call' as const,
          id: item.toolCallId,
          name: item.toolName,
          input: item.args,
          category: categorizeToolCall(item.toolName, categories),
          ...(item.result != null && {
            result: item.result as ToolCallResult,
          }),
        })),
      });
    } else if (part.toolName === '_TaskGroup') {
      const children = part.args.children as PartEntry[];
      const taskArgs = part.args.taskArgs as Record<string, unknown>;
      const agentId = (taskArgs?.description as string) ?? part.toolCallId;
      result.push({
        type: 'task_group',
        agentId,
        calls: children.map((child) => {
          if (child.type !== 'tool-call') return { type: 'text' as const, text: child.text };
          return {
            type: 'tool_call' as const,
            id: child.toolCallId,
            name: child.toolName,
            input: child.args,
            category: categorizeToolCall(child.toolName, categories),
            ...(child.result != null && {
              result: child.result as ToolCallResult,
            }),
          };
        }),
      });
    } else if (part.toolName === '_TaskProgress') {
      result.push({
        type: 'tool_call',
        id: part.toolCallId,
        name: '_TaskProgress',
        input: part.args,
        category: 'progress',
        ...(part.result != null && { result: part.result as ToolCallResult }),
      });
    } else {
      // Regular tool call — find original DisplayContent to preserve result
      const orig = originalContent.find((c) => c.type === 'tool_call' && c.id === part.toolCallId) as
        | (DisplayContent & { type: 'tool_call' })
        | undefined;
      result.push({
        type: 'tool_call',
        id: part.toolCallId,
        name: part.toolName,
        input: part.args,
        category: categorizeToolCall(part.toolName, categories),
        ...(orig?.result && { result: orig.result }),
      });
    }
  }

  return result;
}
