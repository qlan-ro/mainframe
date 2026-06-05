/**
 * Pure DisplayMessage → ThreadMessageLike translator (go-native projection).
 *
 * The top-level switch is thin: assistant content is delegated to the shared
 * recursive `mapAssistantBlocks` (WS14c invariant, \0 sentinel, uniqueId dedup,
 * ≥1-part fallback). Every message rides its daemon-derived data under the ONE
 * `metadata.custom.mainframe` contract (see message-meta.ts); the native
 * `metadata.timing` is the only separate field.
 *
 * Native part model: tool_group → flat tool-calls (grouped client-side) ·
 * task_group → a `Task` tool-call carrying `messages` · task_progress →
 * `_TaskProgress` card · image → native image part.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';
import { mapAssistantBlocks, PERMISSION_PLACEHOLDER, buildAssistantMainframeMeta } from './map-assistant-blocks';
import { type ContentPart, ensureNonEmpty } from './content';
import type { MainframeMessageMeta } from './message-meta';

export { PERMISSION_PLACEHOLDER };

/** Wraps a mainframe payload in the message `metadata.custom.mainframe` envelope. */
function withMainframe(
  extra: Record<string, unknown>,
  mf: MainframeMessageMeta,
): { metadata: Record<string, unknown> } {
  return { metadata: { ...extra, custom: { mainframe: mf } } };
}

export function convertMessage(message: DisplayMessage): ThreadMessageLike {
  const base = { id: message.id, createdAt: new Date(message.timestamp) };

  switch (message.type) {
    case 'user': {
      const parts: ContentPart[] = message.content.flatMap((c): ContentPart[] => {
        if (c.type === 'text' && c.text) return [{ type: 'text', text: c.text }];
        if (c.type === 'image') return [{ type: 'image', image: `data:${c.mediaType};base64,${c.data}` }];
        return [];
      });
      const mf = (message.metadata ?? {}) as MainframeMessageMeta;
      return {
        role: 'user',
        content: ensureNonEmpty(parts),
        ...base,
        ...(Object.keys(mf).length > 0 && withMainframe({}, mf)),
      };
    }

    case 'system': {
      const skillBlock = message.content.find(
        (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
      );
      const textParts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text', text: c.text }));

      const mf: MainframeMessageMeta = {
        ...(message.content.some((c) => c.type === 'compaction') && { isCompacted: true }),
        ...(skillBlock && {
          skillLoaded: { skillName: skillBlock.skillName, path: skillBlock.path, content: skillBlock.content },
        }),
      };
      return {
        role: 'system',
        content: ensureNonEmpty(textParts),
        ...base,
        ...(Object.keys(mf).length > 0 && withMainframe({}, mf)),
      };
    }

    case 'assistant': {
      const { parts, groups, summaries } = mapAssistantBlocks(message.content);
      const costUsd = typeof message.metadata?.cost_usd === 'number' ? message.metadata.cost_usd : undefined;
      const turnMs = typeof message.metadata?.turnDurationMs === 'number' ? message.metadata.turnDurationMs : undefined;

      const mf: MainframeMessageMeta = {
        ...buildAssistantMainframeMeta(groups, summaries),
        ...(costUsd !== undefined && { cost: costUsd }),
      };
      const timing =
        turnMs !== undefined
          ? { timing: { streamStartTime: 0, totalStreamTime: turnMs, totalChunks: 0, toolCallCount: 0 } as const }
          : {};
      const hasMeta = Object.keys(mf).length > 0 || turnMs !== undefined;

      return {
        role: 'assistant',
        content: ensureNonEmpty(parts),
        ...base,
        ...(hasMeta && withMainframe(timing, mf)),
      };
    }

    case 'error': {
      const errorBlock = message.content.find((c): c is DisplayContent & { type: 'error' } => c.type === 'error');
      const errorText = errorBlock?.message?.trim() ? errorBlock.message : 'An error occurred';
      return { role: 'assistant', content: [{ type: 'text', text: errorText }], ...base };
    }

    case 'permission':
      return { role: 'assistant', content: [PERMISSION_PLACEHOLDER], ...base };

    default:
      return { role: 'assistant', content: [{ type: 'text', text: '' }], ...base };
  }
}
