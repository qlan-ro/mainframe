'use client';

/**
 * SystemMessage — centered marker for system-level chat events.
 *
 * Priority (highest wins):
 *   1. isCompacted  → CompactionMarker ("Context compacted")
 *   2. skillLoaded  → the rich SkillLoadedCard ("Using skill: X", expandable)
 *   3. plain text   → quiet marker (AlertTriangle for CLI errors, else Zap)
 *
 * All three are the v2 `Marker variant="separator"` recipe: a centered label
 * between two hairlines. Metadata via the one `useMainframeMeta()` contract.
 * The `*-pill` testids predate the recipe and are kept — e2e keys off them.
 */
import { AlertTriangleIcon, LayersIcon, ZapIcon } from 'lucide-react';
import { MessagePrimitive } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { useMainframeMeta } from '../view-model/message-meta';
import { SkillLoadedCard } from '../tools/cards/SkillLoadedCard';

/** "Context compacted" centered marker. */
export function CompactionPill() {
  return (
    <Marker variant="separator" data-testid="chat-compaction-pill" className="my-2 select-none">
      <MarkerIcon>
        <LayersIcon />
      </MarkerIcon>
      <MarkerContent>Context compacted</MarkerContent>
    </Marker>
  );
}

/** Transient "Compacting…" marker — shown at the transcript tail while a
 *  compaction runs, replaced by CompactionPill when it completes. */
export function CompactingPill() {
  return (
    <Marker variant="separator" data-testid="chat-compacting-pill" className="my-2 select-none">
      <MarkerIcon>
        <span className="block size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      </MarkerIcon>
      <MarkerContent>Compacting…</MarkerContent>
    </Marker>
  );
}

const CLI_ERROR_RE = /^Unknown (?:command|skill):/i;

function SystemTextMarker({ text }: { text: string }) {
  const isError = CLI_ERROR_RE.test(text);
  const Icon = isError ? AlertTriangleIcon : ZapIcon;
  return (
    <Marker variant="separator" className={cn('my-1.5 select-none', isError && 'text-destructive')}>
      <MarkerIcon>
        <Icon />
      </MarkerIcon>
      <MarkerContent>{text}</MarkerContent>
    </Marker>
  );
}

export function SystemMessage() {
  const { isCompacted, skillLoaded } = useMainframeMeta();

  let body = (
    <MessagePrimitive.Parts components={{ Text: ({ text }) => (text ? <SystemTextMarker text={text} /> : null) }} />
  );
  if (isCompacted) body = <CompactionPill />;
  else if (skillLoaded) {
    body = <SkillLoadedCard skillName={skillLoaded.skillName} path={skillLoaded.path} content={skillLoaded.content} />;
  }

  return (
    <MessagePrimitive.Root data-testid="chat-system-message" className="py-0.5">
      {body}
    </MessagePrimitive.Root>
  );
}
