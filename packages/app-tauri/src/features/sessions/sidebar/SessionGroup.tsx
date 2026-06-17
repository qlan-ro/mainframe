/**
 * SessionGroup — one labeled section in the sessions list (Pinned / Today /
 * Yesterday / Earlier / A–Z / By status).
 *
 * Non-collapsible (the time groups are not collapsible per the artboard): a
 * sticky glass header showing the label, plus a leading pin glyph on the
 * 'Pinned' group. Rows come in through a `renderItem` render prop so this file
 * stays free of the SessionRow runtime context; it forwards `inPinnedGroup`
 * (label === 'Pinned') and `showProject` to each row.
 */
import type { ReactNode } from 'react';
import { PinIcon } from 'lucide-react';
import type { SessionGroupResult } from '../view-model/group-sessions';
import type { SessionItem } from '../view-model/chat-to-thread-custom';

export interface SessionGroupRenderFlags {
  inPinnedGroup: boolean;
  showProject: boolean;
}

interface SessionGroupProps {
  group: SessionGroupResult;
  showProject: boolean;
  renderItem: (item: SessionItem, flags: SessionGroupRenderFlags) => ReactNode;
}

export function SessionGroup({ group, showProject, renderItem }: SessionGroupProps) {
  const inPinnedGroup = group.label === 'Pinned';
  return (
    <div data-testid={`sessions-group-${group.label}`}>
      <div
        data-testid={`sessions-group-header-${group.label}`}
        className="sticky top-0 z-[1] flex items-center gap-1 bg-mf-glass px-3 pb-[3px] pt-[7px] text-micro font-bold uppercase tracking-wide text-mf-text-3 backdrop-blur-[40px] backdrop-saturate-[1.8]"
      >
        {inPinnedGroup && (
          <PinIcon data-testid="sessions-group-pin-glyph" className="size-[9px] flex-shrink-0 text-primary" />
        )}
        {group.label}
      </div>
      <div data-testid={`sessions-group-items-${group.label}`}>
        {group.items.map((item) => renderItem(item, { inPinnedGroup, showProject }))}
      </div>
    </div>
  );
}
