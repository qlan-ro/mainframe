/**
 * The session row's one line: project letter, title, then a single trailing
 * value. Everything else the row used to carry (branch, PRs, tags, provider)
 * is in its hover card.
 */
import type { ReactNode } from 'react';
import { FadeLabel } from '@/components/ui/fade-label';
import { useTabHintIndex } from '@/features/session-tabs/use-tab-hint-index';
import { ShortcutIndexBadge } from '@/features/shortcuts/ShortcutIndexBadge';
import { cn } from '@/lib/utils';
import { SessionProjectTile } from './SessionProjectTile';
import { SessionRowStatus } from './SessionRowStatus';
import type { SessionCustom, SessionItem } from './view-model/chat-to-thread-custom';
import { sessionStatus } from './view-model/session-status';

/** What assistive tech hears after the project; the row draws none of it but the unread weight. */
function rowFlags(custom: SessionCustom, unread: boolean): string[] {
  return [
    ...(unread ? ['unread'] : []),
    ...(custom.worktreeMissing ? ['worktree missing'] : []),
    ...(custom.transcriptMissing ? ['transcript missing'] : []),
  ];
}

interface RowBodyProps {
  item: SessionItem;
  unread: boolean;
  projectName?: string;
  renameSlot: ReactNode | null;
  /** The hover action cluster, revealed inline just before the trailing value. */
  actionsSlot: ReactNode;
}

export function RowBody({ item, unread, projectName, renameSlot, actionsSlot }: RowBodyProps) {
  const { custom } = item;
  const hintIndex = useTabHintIndex(item.id);
  const project = custom.noProject ? undefined : projectName;
  return (
    <>
      <SessionProjectTile projectName={project} />
      {renameSlot ?? (
        // No tooltip on the title: the hover card already carries it in full.
        <FadeLabel
          data-testid="sessions-row-title"
          data-unread={unread || undefined}
          className={cn(
            'flex-1 group-data-active/menu-item:text-sidebar-foreground',
            unread ? 'font-semibold text-sidebar-foreground' : 'text-sidebar-foreground/85',
          )}
        >
          {item.title ?? 'Untitled session'}
        </FadeLabel>
      )}
      <span className="sr-only">{`, ${[project ?? 'No project', ...rowFlags(custom, unread)].join(', ')},`}</span>
      {/* Actions sit in front of the trailing value, which stays put — the
          truncating title is what gives way on hover. On a row too narrow for
          both, the value yields instead, so the title keeps its room. */}
      {actionsSlot}
      {/* While the hints show, the row trades its value for the ⌘N that reaches
          it. A row whose session has no open tab has no number. */}
      {hintIndex != null ? (
        <ShortcutIndexBadge index={hintIndex} data-testid="sessions-row-hint" />
      ) : (
        <SessionRowStatus
          status={sessionStatus(custom)}
          updatedAt={custom.updatedAt}
          yieldsToActions={actionsSlot != null}
        />
      )}
    </>
  );
}
