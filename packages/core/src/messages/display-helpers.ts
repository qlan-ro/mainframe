import type { MessageContent, ToolCategories, DisplayContent, ToolCallResult } from '@qlan-ro/mainframe-types';
import { stripMainframeCommandTags, parseCommandMessage, parseAttachedFilePathTags } from './message-parsing.js';
import type { GroupedMessage } from './message-grouping.js';
import type { PartEntry } from './tool-grouping.js';
import { groupToolCallParts, groupTaskChildren } from './tool-grouping.js';
import { truncateToolContent } from './truncate-tool-content.js';
import { parseAskUserQuestionResult, type KnownQuestion } from './parse-ask-user-question.js';

const INTERNAL_USER_RE = /<mainframe-command[\s>]/;

/** Returns `{ parentToolUseId: id }` when `id` is set, an empty object otherwise. */
export function withParentId(id: string | undefined): { parentToolUseId: string } | Record<string, never> {
  return id ? { parentToolUseId: id } : {};
}

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

function extractKnownQuestions(toolInput: unknown): KnownQuestion[] | undefined {
  if (typeof toolInput !== 'object' || toolInput === null) return undefined;
  const q = (toolInput as { questions?: unknown }).questions;
  if (!Array.isArray(q)) return undefined;
  return q
    .filter((item): item is { question: string } => typeof item?.question === 'string')
    .map((item) => {
      const i = item as { question: string; multiSelect?: boolean; options?: { label: string }[] };
      return { question: i.question, multiSelect: i.multiSelect, options: i.options };
    });
}

/** Build a ToolCallResult from a tool_result content block. */
export function toToolCallResult(
  block: MessageContent & { type: 'tool_result' },
  toolName?: string,
  toolInput?: unknown,
): ToolCallResult {
  const t = truncateToolContent(block.content);
  return {
    content: t.content,
    isError: block.isError,
    ...(t.truncated ? { truncated: true, fullBytes: t.fullBytes } : {}),
    ...(block.structuredPatch && { structuredPatch: block.structuredPatch }),
    ...(block.originalFile && { originalFile: block.originalFile }),
    ...(block.modifiedFile && { modifiedFile: block.modifiedFile }),
    ...(toolName === 'AskUserQuestion'
      ? { askUserQuestion: parseAskUserQuestionResult(block.content, extractKnownQuestions(toolInput)) }
      : {}),
  };
}

/** Convert a grouped assistant message to DisplayContent[]. */
export function convertAssistantContent(grouped: GroupedMessage, categories?: ToolCategories): DisplayContent[] {
  const seenToolIds = new Set<string>();
  const content: DisplayContent[] = [];

  for (const block of grouped.content) {
    if (block.type === 'text') {
      const stripped = stripMainframeCommandTags(block.text);
      if (stripped)
        content.push({
          type: 'text',
          text: stripped,
          ...withParentId(block.parentToolUseId),
        });
    } else if (block.type === 'thinking') {
      content.push({
        type: 'thinking',
        thinking: block.thinking,
        ...withParentId(block.parentToolUseId),
      });
    } else if (block.type === 'image') {
      content.push({
        type: 'image',
        mediaType: block.mediaType,
        data: block.data,
        ...withParentId(block.parentToolUseId),
      });
    } else if (block.type === 'tool_use') {
      if (seenToolIds.has(block.id)) continue;
      seenToolIds.add(block.id);

      const resultBlock = grouped._toolResults?.get(block.id);
      const baseCategory = categorizeToolCall(block.name, categories);
      const call: DisplayContent & { type: 'tool_call' } = {
        type: 'tool_call',
        id: block.id,
        name: block.name,
        input: block.input,
        category: block.name === 'AskUserQuestion' && resultBlock ? 'default' : baseCategory,
        ...withParentId(block.parentToolUseId),
      };
      if (resultBlock) call.result = toToolCallResult(resultBlock, block.name, block.input);
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
      if (!block.text || block.text.startsWith('[Request interrupted')) continue;

      const cmdInfo = parseCommandMessage(block.text);
      if (cmdInfo) {
        // Only synthesize a user bubble when the raw text includes a <command-message>
        // tag — that tag is present exclusively for user-typed slash commands. Subagent
        // and replay CLI echoes emit bare <command-name>…</command-name> with no
        // <command-message> wrapper; those are internal CLI metadata, not user input,
        // so we suppress them to avoid a spurious empty bubble in the Explore thread.
        const hasCommandMessage = block.text.includes('<command-message>');
        if (!hasCommandMessage) continue;

        metadata.command = { name: cmdInfo.commandName, userText: cmdInfo.userText };
        metadata.cleanText = cmdInfo.userText;
        // Synthesize a readable bubble from the CLI's <command-name>/<command-args>
        // echo. The raw XML is pure CLI metadata — users want to see what they typed.
        const args = cmdInfo.userText.trim();
        const rendered = args ? `/${cmdInfo.commandName} ${args}` : `/${cmdInfo.commandName}`;
        displayContent.push({
          type: 'text',
          text: rendered,
          ...withParentId(block.parentToolUseId),
        });
        continue;
      }

      const { files, cleanText } = parseAttachedFilePathTags(block.text);
      if (files.length > 0) metadata.attachedFiles = files;

      const textToStore = files.length > 0 ? cleanText : block.text;

      if (textToStore)
        displayContent.push({
          type: 'text',
          text: textToStore,
          ...withParentId(block.parentToolUseId),
        });
    } else if (block.type === 'image') {
      displayContent.push({
        type: 'image',
        mediaType: block.mediaType,
        data: block.data,
        ...withParentId(block.parentToolUseId),
      });
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
        category: c.category,
        ...withParentId(c.parentToolUseId),
      };
    }
    if (c.type === 'text') return { type: 'text' as const, text: c.text, ...withParentId(c.parentToolUseId) };
    // Non-groupable content (thinking, image, etc.) is carried as a first-class
    // passthrough entry so it flows through grouping in-place without encoding.
    // parentToolUseId is preserved so groupTaskChildren can include passthrough
    // entries belonging to a subagent's children.
    return {
      type: 'passthrough' as const,
      content: c,
      ...withParentId('parentToolUseId' in c ? c.parentToolUseId : undefined),
    };
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

  for (const part of parts) {
    switch (part.type) {
      case 'passthrough': {
        // Non-groupable content flows through directly; the original DisplayContent
        // already carries parentToolUseId from the mapping step.
        result.push(part.content);
        break;
      }

      case 'text': {
        if (part.text) {
          result.push({
            type: 'text',
            text: part.text,
            ...withParentId(part.parentToolUseId),
          });
        }
        break;
      }

      case '_tool_group': {
        result.push({
          type: 'tool_group',
          calls: part.items.map((item) => ({
            type: 'tool_call' as const,
            id: item.toolCallId,
            name: item.toolName,
            input: item.args,
            category: categorizeToolCall(item.toolName, categories),
            ...(item.result != null && { result: item.result as ToolCallResult }),
            ...withParentId(item.parentToolUseId),
          })),
        });
        break;
      }

      case '_task_group': {
        // Use the unique tool_use id, not `description`. Two subagents in the same
        // turn can share a description string (role label, repeat prompt) and
        // collapsing them onto one id collides assistant-ui's per-part React key
        // (`toolCallId-<id>`), crashing the message renderer. The user-facing
        // label still reads from `taskArgs.description` in the TaskGroup card.
        const agentId = part.toolCallId;
        result.push({
          type: 'task_group',
          agentId,
          taskArgs: part.taskArgs ?? {},
          calls: part.children.map((child) => {
            if (child.type === 'passthrough') {
              // The original DisplayContent already carries parentToolUseId;
              // pass it through unchanged.
              return child.content;
            }
            if (child.type === 'text') {
              return { type: 'text' as const, text: child.text, ...withParentId(child.parentToolUseId) };
            }
            if (child.type === 'tool-call') {
              return {
                type: 'tool_call' as const,
                id: child.toolCallId,
                name: child.toolName,
                input: child.args,
                category: categorizeToolCall(child.toolName, categories),
                ...(child.result != null && { result: child.result as ToolCallResult }),
                ...withParentId(child.parentToolUseId),
              };
            }
            // Recursively resolve any nested grouped entry (e.g. a _tool_group
            // collapsed inside a subagent's explore burst).
            const nested = convertGroupedPartsToDisplay([child], originalContent, categories);
            return nested.length === 1 ? nested[0]! : { type: 'text' as const, text: '' };
          }),
          ...(part.result != null && { result: part.result as ToolCallResult }),
        });
        break;
      }

      case '_task_progress': {
        result.push({
          type: 'task_progress',
          items: part.items.map((item) => ({
            id: item.toolCallId,
            name: item.toolName,
            input: item.args,
            category: 'progress' as const,
            ...(item.result != null && { result: item.result as ToolCallResult }),
          })),
        });
        break;
      }

      case 'tool-call': {
        // Regular tool call — find original DisplayContent to preserve result and category
        const orig = originalContent.find((c) => c.type === 'tool_call' && c.id === part.toolCallId) as
          | (DisplayContent & { type: 'tool_call' })
          | undefined;
        result.push({
          type: 'tool_call',
          id: part.toolCallId,
          name: part.toolName,
          input: part.args,
          category: orig?.category ?? categorizeToolCall(part.toolName, categories),
          ...(orig?.result && { result: orig.result }),
          ...withParentId(part.parentToolUseId),
        });
        break;
      }

      default: {
        // Exhaustiveness check — TypeScript ensures every PartEntry variant is handled.
        // Unreachable at runtime; the assignment fails to compile if a variant is added.
        const _exhaustive: never = part;
        void _exhaustive;
        break;
      }
    }
  }

  return result;
}
