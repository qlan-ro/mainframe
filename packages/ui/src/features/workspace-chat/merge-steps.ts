/**
 * Two copies of a sub-agent's steps, joined: the stream's (what lies above the parent's history
 * floor is missing) and the tab's fetched one (a snapshot). A sub-agent's steps are one message
 * whose parts are the steps, so the join is part by part, by the keys the converter gave them
 * (`partKeys`). The part-source table is rebuilt for the joined parts, for readers that look a
 * part's source up by its position.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import type { MainframeMessageMeta } from '@/features/chat/view-model/message-meta';
import type { NativePartSource, PartSources } from '@/features/chat/view-model/transcript-presentation';

type Part = ThreadMessage['content'][number];
interface Entry {
  part: Part;
  key: string;
  sources: readonly NativePartSource[] | undefined;
}

const metaOf = (message: ThreadMessage) => message.metadata?.custom?.mainframe as MainframeMessageMeta | undefined;

function entriesOf(message: ThreadMessage): Entry[] | null {
  const meta = metaOf(message);
  const parts = message.content as readonly Part[];
  if (!meta?.partKeys || meta.partKeys.length !== parts.length) return null;
  return parts.map((part, index) => ({ part, key: meta.partKeys![index]!, sources: meta.partSources?.[index] }));
}

function join(fetched: ThreadMessage, live: ThreadMessage): ThreadMessage {
  const older = entriesOf(fetched);
  const newer = entriesOf(live);
  if (!older || !newer || live.role !== 'assistant') return live;
  const liveByKey = new Map(newer.map((entry) => [entry.key, entry]));
  const joined = older.map((entry) => liveByKey.get(entry.key) ?? entry);
  // A part only the stream has goes right after the part before it in the stream.
  // With no shared part before it, it goes before the stream's next shared part
  // (the fetch may have been cut to the newest steps), or last if none is shared.
  const fetchedKeys = new Set(older.map(({ key }) => key));
  let anchor = -1;
  newer.forEach((entry, index) => {
    const at = joined.findIndex(({ key }) => key === entry.key);
    if (at >= 0) {
      anchor = at;
      return;
    }
    if (anchor < 0) {
      const next = newer.slice(index + 1).find(({ key }) => fetchedKeys.has(key));
      const before = next ? joined.findIndex(({ key }) => key === next.key) : -1;
      anchor = before >= 0 ? before : joined.length;
    } else {
      anchor += 1;
    }
    joined.splice(anchor, 0, entry);
  });
  const sources: Record<number, readonly NativePartSource[]> = {};
  joined.forEach(({ sources: found }, index) => {
    if (found) sources[index] = found;
  });
  const { partSources: _stale, ...meta } = metaOf(live)!;
  void _stale;
  return {
    ...live,
    content: joined.map(({ part }) => part),
    metadata: {
      ...live.metadata,
      custom: {
        ...live.metadata.custom,
        mainframe: {
          ...meta,
          partKeys: joined.map(({ key }) => key),
          ...(Object.keys(sources).length > 0 && { partSources: sources as PartSources }),
        },
      },
    },
  } as ThreadMessage;
}

/** The steps of both copies, in order: the stream's where it has a step, the fetched copy's for the rest. */
export function mergeSteps(
  fetched: readonly ThreadMessage[] = [],
  live: readonly ThreadMessage[] = [],
): readonly ThreadMessage[] {
  if (fetched.length === 0) return live;
  if (live.length === 0) return fetched;
  const liveById = new Map(live.map((step) => [step.id, step]));
  const known = new Set(fetched.map((step) => step.id));
  const merged = fetched.map((step) => {
    const current = liveById.get(step.id);
    return current ? join(step, current) : step;
  });
  return [...merged, ...live.filter((step) => !known.has(step.id))];
}
