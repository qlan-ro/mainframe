'use client';

/**
 * Context usage beside Send (C2): a 16px ring with its percentage. At 95% and
 * above it opens "Compact conversation"; below that it only explains itself.
 */

import { useAui, useAuiState } from '@assistant-ui/react';
import { Minimize2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useContextPercent } from '@/features/session-panel/use-context-percent';
import { formatTokenCount } from '@/features/session-panel/context-tokens';
import { matchCommandInvocation } from '../../commands/command-registry';
import { useChatExtras } from '../../runtime/chat-extras';
import { ComposerHint } from '../composer-card-context';
import { toolbarButton } from './toolbar-button';

const WARN_AT = 80;
export const COMPACT_AT = 95;
const RADIUS = 6.25;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const COMPACT_COMMAND = '/compact';

function Ring({ percent }: { percent: number }) {
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * CIRCUMFERENCE;
  const circle = { cx: 8, cy: 8, r: RADIUS, fill: 'none', strokeWidth: 2 };
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
      {/* A visible full track, so the ring reads as a gauge and never as a spinner. */}
      <circle {...circle} className="stroke-foreground/26" />
      <circle
        {...circle}
        className="stroke-current transition-[stroke-dasharray] duration-300 motion-reduce:transition-none"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

export function ContextRing() {
  const known = useContextPercent();
  // Before the first message nothing is in the window yet (C2: always visible).
  const fresh = useAuiState((s) => s.thread.messages.length === 0);
  const percent = known ?? (fresh ? 0 : null);
  const usage = useChatExtras()?.state.contextUsage;
  const aui = useAui();
  if (percent == null) return null;

  const full = percent >= COMPACT_AT;
  const tokens =
    usage != null ? ` · ${formatTokenCount(usage.totalTokens)} of ${formatTokenCount(usage.maxTokens)} tokens` : '';
  const label = `Context ${percent}% used${tokens}`;
  const button = (
    <button
      type="button"
      data-testid="composer-context-percent"
      aria-label={full ? `${label}. Compact conversation` : label}
      className={toolbarButton(
        false,
        cn(
          'shrink-0 px-1.5 text-meta/[1.45] font-medium tabular-nums @max-[320px]/composer:px-1',
          full ? 'text-crit' : percent >= WARN_AT ? 'text-warning' : 'text-muted-foreground',
        ),
      )}
    >
      <Ring percent={percent} />
      {percent}%
    </button>
  );
  if (!full) return <ComposerHint label={label}>{button}</ComposerHint>;

  const canCompact = matchCommandInvocation(COMPACT_COMMAND) != null;
  return (
    <DropdownMenu>
      <ComposerHint label={`${label} · Click to compact`}>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      </ComposerHint>
      <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-auto min-w-67.5">
        <DropdownMenuItem
          data-testid="composer-context-compact"
          disabled={!canCompact}
          onSelect={() => aui.thread.append({ role: 'user', content: [{ type: 'text', text: COMPACT_COMMAND }] })}
        >
          <Minimize2 />
          <span className="flex flex-col">
            <span>Compact conversation</span>
            {!canCompact && (
              <span className="text-meta/[1.35] font-normal text-muted-foreground">
                This agent has no compact command
              </span>
            )}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
