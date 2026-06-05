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
      // Map text parts (primary content)
      const textParts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text' && !!c.text)
        .map((c) => ({ type: 'text' as const, text: c.text }));

      // Map inline image parts (base64 thumbnails embedded by the daemon pipeline)
      const imageParts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'image' } => c.type === 'image')
        .map((c) => ({
          type: 'image' as const,
          image: `data:${c.mediaType};base64,${c.data}`,
        }));

      const parts: ContentPart[] = [...textParts, ...imageParts];

      // Carry daemon-side metadata (queued flag, cleanText, command info,
      // file attachments) so UserMessage can render the cool-card variants
      // without reaching into DisplayMessage directly.
      const meta = message.metadata ?? {};
      const custom: Record<string, unknown> = { ...meta };

      return {
        role: 'user',
        content: ensureNonEmpty(parts),
        id: message.id,
        createdAt: new Date(message.timestamp),
        ...(Object.keys(custom).length > 0 && {
          metadata: { custom: { mainframe: custom } },
        }),
      };
    }

    case 'system': {
      const skillBlock = message.content.find(
        (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
      );
      const isCompacted = message.content.some((c) => c.type === 'compaction');
      const textParts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text }));

      const meta: Record<string, unknown> = { ...(message.metadata ?? {}) };
      if (isCompacted) {
        meta['isCompacted'] = true;
      }
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

      // Daemon attaches turnDurationMs to the message.metadata after each
      // result event. Map it to the native metadata.timing shape so
      // MessageTiming (and useMessageTiming()) can read it.
      const turnDurationMs =
        typeof message.metadata?.turnDurationMs === 'number' ? message.metadata.turnDurationMs : undefined;
      // Session-level cost is occasionally written back to the message by the
      // daemon pipeline. Carry it in custom.mainframe.cost so MessageTiming can
      // show a Cost row without needing a separate context.
      const costUsd = typeof message.metadata?.cost_usd === 'number' ? message.metadata.cost_usd : undefined;

      const hasGroups = Object.keys(groups).length > 0;
      const hasTiming = turnDurationMs !== undefined;
      const hasCost = costUsd !== undefined;

      const metadata =
        hasGroups || hasTiming || hasCost
          ? {
              ...(hasTiming && {
                timing: {
                  streamStartTime: 0,
                  totalStreamTime: turnDurationMs,
                  totalChunks: 0,
                  toolCallCount: 0,
                } as const,
              }),
              custom: {
                mainframe: {
                  ...(hasGroups && { partGroups: groups }),
                  ...(hasCost && { cost: costUsd }),
                },
              },
            }
          : undefined;

      return {
        role: 'assistant',
        content: ensureNonEmpty(parts),
        id: message.id,
        createdAt: new Date(message.timestamp),
        ...(metadata && { metadata }),
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
