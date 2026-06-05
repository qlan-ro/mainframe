'use client';

/**
 * SystemMessage — centered marker for system-level chat events.
 *
 * Priority (highest wins):
 *   1. isCompacted  → CompactionPill  ("Context compacted")
 *   2. skillLoaded  → links to the SkillLoadedCard tool card (already handled
 *      via the tool registry path; here we show a simple "skill loaded" pill
 *      as the system message shell). The convert-message puts skillLoaded data
 *      in metadata; the _SkillLoaded tool card handles the rich card. This
 *      component falls through to the text/pill path when no tool message exists.
 *   3. plain text   → quiet ZapIcon pill (or AlertTriangle for CLI errors)
 *
 * Token notes:
 *   - bg-mf-chip (not bg-mf-hover/opacity — no /opacity modifier on --mf-* vars)
 *   - text-mf-text-3 for secondary icon+text
 *   - rounded-full per artboard "system markers" family
 *
 * data-testid: chat-system-message (root), chat-compaction-pill (compaction pill)
 */
import { AlertTriangleIcon, LayersIcon, ZapIcon } from 'lucide-react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';

// ── Type helpers ──────────────────────────────────────────────────────────────

interface SystemMeta {
  isCompacted?: boolean;
  skillLoaded?: {
    skillName: string;
    path: string;
    content: string;
  };
}

function useSystemMeta(): SystemMeta {
  // Two stable selectors — a single selector returning {isCompacted, skillLoaded}
  // is a fresh object each render and loops (getSnapshot). Booleans compare by
  // value; the skillLoaded object ref is stable from the store.
  const isCompacted = useAuiState(
    (s) => (s.message.metadata as Record<string, unknown> | undefined)?.['isCompacted'] === true,
  );
  const skillLoaded = useAuiState((s) => {
    const v = (s.message.metadata as Record<string, unknown> | undefined)?.['skillLoaded'];
    return isSkillLoadedMeta(v) ? (v as SystemMeta['skillLoaded']) : undefined;
  });
  return { isCompacted, skillLoaded };
}

function isSkillLoadedMeta(v: unknown): v is { skillName: string; path: string; content: string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['skillName'] === 'string';
}

// ── CompactionPill ─────────────────────────────────────────────────────────────

/**
 * "Context compacted" centered pill.
 * Warm-chrome port of desktop CompactionPill.tsx; uses real tokens only.
 */
export function CompactionPill() {
  return (
    <div className="flex justify-center my-2">
      <div
        data-testid="chat-compaction-pill"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1',
          'bg-mf-chip border border-border',
          'font-mono text-caption text-mf-text-3 select-none',
        )}
      >
        <LayersIcon size={11} className="shrink-0 text-mf-text-3" />
        <span>Context compacted</span>
      </div>
    </div>
  );
}

// ── CLI error detection ───────────────────────────────────────────────────────

const CLI_ERROR_PATTERNS = [/^Unknown (?:command|skill):/i];

function isCliError(text: string): boolean {
  return CLI_ERROR_PATTERNS.some((re) => re.test(text));
}

// ── SystemTextPill — quiet centered pill for plain system text ────────────────

interface SystemTextPillProps {
  text: string;
}

function SystemTextPill({ text }: SystemTextPillProps) {
  const isError = isCliError(text);
  const Icon = isError ? AlertTriangleIcon : ZapIcon;

  return (
    <div className="flex justify-center my-1.5">
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1',
          'font-mono text-caption select-none border',
          isError ? 'bg-destructive/10 border-destructive text-destructive' : 'bg-mf-chip border-border text-mf-text-3',
        )}
      >
        <Icon size={11} className="shrink-0" />
        <span>{text}</span>
      </div>
    </div>
  );
}

// ── SystemMessage — public component ─────────────────────────────────────────

export function SystemMessage() {
  const { isCompacted, skillLoaded } = useSystemMeta();

  // 1. Compaction takes absolute priority.
  if (isCompacted) {
    return (
      <MessagePrimitive.Root data-testid="chat-system-message" className="py-0.5">
        <CompactionPill />
      </MessagePrimitive.Root>
    );
  }

  // 2. Skill-loaded: the rich card is rendered by the _SkillLoaded tool call
  //    (already wired in the tool registry via SkillLoadedCard). Here we emit
  //    a quiet "skill loaded" pill in case the system message also carries text
  //    (or the tool registry path is not available). If skillLoaded is present
  //    and there is no text part, render a minimal pill.
  //    (The orchestrator may later choose to suppress this entirely if the tool
  //    card always covers it — flag in design-deltas below.)
  if (skillLoaded && !skillLoaded.skillName) {
    // Malformed — fall through to text rendering.
  } else if (skillLoaded) {
    // The SkillLoadedCard tool path renders the full card; this pill is a
    // system-message-level fallback (no text content present).
    return (
      <MessagePrimitive.Root data-testid="chat-system-message" className="py-0.5">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => (text ? <SystemTextPill text={text} /> : null),
          }}
        />
      </MessagePrimitive.Root>
    );
  }

  // 3. Plain text pill.
  return (
    <MessagePrimitive.Root data-testid="chat-system-message" className="py-0.5">
      <MessagePrimitive.Parts
        components={{
          Text: ({ text }) => (text ? <SystemTextPill text={text} /> : null),
        }}
      />
    </MessagePrimitive.Root>
  );
}
