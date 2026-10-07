/**
 * The session row's title + time line, plus the meta line — extracted from
 * `SessionRow.tsx` to keep that file under the project's line limit.
 *
 * Two lines — title plus time, then the meta line — beside one status column.
 * The status glyph stays a sibling of the whole stack rather than of the title,
 * so the button's own `items-center` centres it across both lines.
 */
import type { ReactNode } from 'react';
import { PinIcon } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { FadeLabel } from '@/components/ui/fade-label';
import { useTabHintIndex } from '@/features/session-tabs/use-tab-hint-index';
import { ShortcutIndexBadge } from '@/features/shortcuts/ShortcutIndexBadge';
import { formatCompactTime } from './compact-time';
import { LINEAGE_GLYPH, taskLabel } from './lineage-glyph';
import type { LineageRelation } from './view-model/fork-lineage';
import type { SessionItem } from './view-model/chat-to-thread-custom';
import type { SessionBadge } from './view-model/session-status';
import { SessionRowMetaLine, type ForkFallback } from './SessionRowMetaLine';
import { StatusDot } from './StatusDot';

interface RowBodyProps {
  item: SessionItem;
  badge: SessionBadge;
  colorOf: (name: string) => TagColor;
  projectName?: string;
  showPinGlyph: boolean;
  renameSlot: ReactNode | null;
  /** The hover action cluster, revealed inline just before the time. */
  actionsSlot: ReactNode;
  /** Set when this row nests under its parent (variant D) — leads the title with the relation's glyph. */
  nestedAs?: LineageRelation;
  /** Set only for a non-nested fork — the meta line's trailing fallback glyph. */
  forkFallback?: ForkFallback;
}

export function RowBody({
  item,
  badge,
  colorOf,
  projectName,
  showPinGlyph,
  renameSlot,
  actionsSlot,
  nestedAs,
  forkFallback,
}: RowBodyProps) {
  const { custom } = item;
  const hintIndex = useTabHintIndex(item.id);
  const NestGlyph = nestedAs != null ? LINEAGE_GLYPH[nestedAs] : null;
  return (
    <>
      <StatusDot badge={badge} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* h-4.5 pins the line at text-sm's own 18px line-height: WKWebView
            rounds the bare text line to 17px, so without it the 18px action
            glyphs grow the hovered row and nudge every row below by 1px. */}
        <span className="flex h-4.5 items-center gap-1.5">
          {NestGlyph != null && (
            <NestGlyph
              aria-hidden
              data-testid={
                nestedAs === 'delegated' ? 'sessions-row-delegated-nest-glyph' : 'sessions-row-fork-nest-glyph'
              }
              className="size-3! shrink-0 text-muted-foreground"
            />
          )}
          {renameSlot ?? (
            // No tooltip on the title: the hover card already carries it in full.
            <FadeLabel
              data-testid="sessions-row-title"
              className="flex-1 text-muted-foreground group-data-active/menu-item:text-primary"
            >
              {item.title ?? 'Untitled session'}
            </FadeLabel>
          )}
          {showPinGlyph && <PinIcon data-testid="sessions-row-pin-glyph" className="size-3! shrink-0 text-primary" />}
          {/* Actions sit in front of the time, which stays put — the truncating
              title is the only thing that gives way on hover. */}
          {actionsSlot}
          {/* While the hints show, the row trades its timestamp for the ⌘N that
              reaches it — same trailing slot, so nothing below shifts. A row
              whose session has no open tab has no number and keeps the time. */}
          {hintIndex != null ? (
            <ShortcutIndexBadge index={hintIndex} data-testid="sessions-row-hint" />
          ) : (
            <span
              data-testid="sessions-row-relative-time"
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {formatCompactTime(custom.updatedAt, Date.now())}
            </span>
          )}
        </span>
        <SessionRowMetaLine
          projectName={projectName}
          waiting={badge.base === 'waiting'}
          adapterId={custom.adapterId}
          noProject={custom.noProject}
          worktreePath={custom.worktreePath}
          branchName={custom.branchName}
          worktreeMissing={custom.worktreeMissing}
          temporary={custom.temporary}
          detectedPrs={custom.detectedPrs}
          tags={custom.tags}
          colorOf={colorOf}
          forkFallback={forkFallback}
          taskLabel={custom.delegation != null ? taskLabel(custom.delegation.role) : undefined}
        />
      </span>
    </>
  );
}
