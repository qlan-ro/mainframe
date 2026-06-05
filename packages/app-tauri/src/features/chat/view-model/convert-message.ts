/**
 * Pure DisplayMessage → ThreadMessageLike translator (go-native projection).
 *
 * The top-level switch is thin: assistant content is delegated to the shared
 * recursive `mapAssistantBlocks` (which also projects the subagent transcript),
 * so the WS14c invariant, the \0 permission sentinel, per-scope uniqueId dedup,
 * and the ≥1-content-part fallback all live in one place.
 *
 * Native part model (replaces the desktop synthetic encoding):
 * - tool_group   → flat native tool-calls (grouped client-side by GroupedParts)
 * - task_group   → a `Task` tool-call carrying `messages` (subagent transcript)
 * - task_progress→ a `_TaskProgress` card part · skill_loaded → `_SkillLoaded`
 * - image        → native image part (no longer skipped)
 *
 * Temporary duplication of the desktop converter; dedup into a shared
 * @qlan-ro/mainframe view-model package in a follow-up (tracker open decision).
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';
import { mapAssistantBlocks, PERMISSION_PLACEHOLDER } from './map-assistant-blocks';

export { PERMISSION_PLACEHOLDER };

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

function ensureNonEmpty(parts: ContentPart[]): ContentPart[] {
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

export function convertMessage(message: DisplayMessage): ThreadMessageLike {
  switch (message.type) {
    case 'user': {
      const parts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text' && !!c.text)
        .map((c) => ({ type: 'text' as const, text: c.text }));

      return {
        role: 'user',
        content: ensureNonEmpty(parts),
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'system': {
      const skillBlock = message.content.find(
        (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
      );
      const textParts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text }));

      const meta: Record<string, unknown> = { ...(message.metadata ?? {}) };
      if (skillBlock) {
        meta['skillLoaded'] = {
          skillName: skillBlock.skillName,
          path: skillBlock.path,
          content: skillBlock.content,
        };
      }

      return {
        role: 'system',
        content: ensureNonEmpty(textParts),
        id: message.id,
        createdAt: new Date(message.timestamp),
        ...(Object.keys(meta).length > 0 && { metadata: meta }),
      };
    }

    case 'assistant': {
      const { parts, groups } = mapAssistantBlocks(message.content);
      return {
        role: 'assistant',
        content: ensureNonEmpty(parts),
        id: message.id,
        createdAt: new Date(message.timestamp),
        ...(Object.keys(groups).length > 0 && { metadata: { custom: { mainframe: { partGroups: groups } } } }),
      };
    }

    case 'error': {
      const errorBlock = message.content.find((c): c is DisplayContent & { type: 'error' } => c.type === 'error');
      const errorText = errorBlock?.message?.trim() ? errorBlock.message : 'An error occurred';
      return {
        role: 'assistant',
        content: [{ type: 'text', text: errorText }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'permission':
      return {
        role: 'assistant',
        content: [PERMISSION_PLACEHOLDER],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    default:
      return {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
  }
}
