import { ExportedMessageRepository, type ThreadMessage, type ThreadMessageLike } from '@assistant-ui/react';
import type { MainframeMessageMeta } from './message-meta';
import type { PartSources } from './transcript-presentation';

function remapSources(original: ThreadMessageLike, normalized: ThreadMessage): ThreadMessage {
  const meta = normalized.metadata.custom.mainframe as MainframeMessageMeta | undefined;
  const parts = original.content;
  if (
    original.role !== 'assistant' ||
    normalized.role !== 'assistant' ||
    (!meta?.partSources && !meta?.partKeys) ||
    typeof parts === 'string' ||
    parts.length === normalized.content.length
  )
    return normalized;
  const sources: Record<number, PartSources[number]> = {};
  const keys: string[] = [];
  let nextIndex = 0;
  for (const [index, part] of parts.entries()) {
    const count = ExportedMessageRepository.fromArray([{ ...original, content: [part] }]).messages[0]!.message.content
      .length;
    if (count === 1 && meta.partSources?.[index]) sources[nextIndex] = meta.partSources[index];
    if (count === 1 && meta.partKeys?.[index] !== undefined) keys[nextIndex] = meta.partKeys[index]!;
    nextIndex += count;
  }
  const aligned = nextIndex === normalized.content.length;
  return {
    ...normalized,
    metadata: {
      ...normalized.metadata,
      custom: {
        ...normalized.metadata.custom,
        mainframe: {
          ...meta,
          ...(meta.partSources && { partSources: aligned ? sources : {} }),
          ...(meta.partKeys && { partKeys: aligned && keys.length === normalized.content.length ? keys : undefined }),
        },
      },
    },
  };
}

/** One like → its native `ThreadMessage`, presentation sources re-indexed past any part the normalizer dropped. */
export function normalizeNativeMessage(message: ThreadMessageLike): ThreadMessage {
  const normalized = ExportedMessageRepository.fromArray([message]).messages[0]!.message;
  return remapSources(message, normalized);
}

export function normalizeNativeRepository(messages: readonly ThreadMessageLike[]): ExportedMessageRepository {
  const repository = ExportedMessageRepository.fromArray(messages);
  return {
    ...repository,
    messages: repository.messages.map((entry, index) => ({
      ...entry,
      message: remapSources(messages[index]!, entry.message),
    })),
  };
}
