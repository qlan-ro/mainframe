'use client';

/**
 * SystemMessage — centered marker for system-level chat events.
 *
 * Priority (highest wins):
 *   1. isCompacted  → CompactionPill ("Context compacted")
 *   2. skillLoaded  → the rich SkillLoadedCard ("Using skill: X", expandable)
 *   3. plain text   → quiet pill (AlertTriangle for CLI errors, else Zap)
 *
 * Metadata via the one `useMainframeMeta()` contract. Tokens: bg-mf-chip /
 * text-mf-text-3 (no /opacity on --mf-* vars). data-testid: chat-system-message.
 */
import { AlertTriangleIcon, LayersIcon, ZapIcon } from 'lucide-react';
import { MessagePrimitive } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { useMainframeMeta } from '../view-model/message-meta';
import { SkillLoadedCard } from '../tools/cards/SkillLoadedCard';

/** "Context compacted" centered pill. */
export function CompactionPill() {
  return (
    <div className="my-2 flex justify-center">
      <div
        data-testid="chat-compaction-pill"
        className="inline-flex select-none items-center gap-1.5 rounded-full border border-border bg-mf-content2 px-3 py-1 font-mono text-caption text-mf-text-3"
      >
        <LayersIcon size={11} className="shrink-0 text-mf-text-3" />
        <span>Context compacted</span>
      </div>
    </div>
  );
}

const CLI_ERROR_RE = /^Unknown (?:command|skill):/i;

function SystemTextPill({ text }: { text: string }) {
  const isError = CLI_ERROR_RE.test(text);
  const Icon = isError ? AlertTriangleIcon : ZapIcon;
  return (
    <div className="my-1.5 flex justify-center">
      <div
        className={cn(
          'inline-flex select-none items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-caption',
          isError
            ? 'border-destructive bg-mf-destructive-tint text-destructive'
            : 'border-border bg-mf-content2 text-mf-text-3',
        )}
      >
        <Icon size={11} className="shrink-0" />
        <span>{text}</span>
      </div>
    </div>
  );
}

export function SystemMessage() {
  const { isCompacted, skillLoaded } = useMainframeMeta();

  let body = (
    <MessagePrimitive.Parts components={{ Text: ({ text }) => (text ? <SystemTextPill text={text} /> : null) }} />
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
