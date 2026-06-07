/**
 * SessionGroup — one collapsible project section in the sidebar.
 * Collapse state persists via useCollapsedProjects (localStorage). SessionRow
 * children come in as a render prop so this file does not import SessionRow
 * (which needs the thread-list runtime context).
 */
import type { ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { useCollapsedProjects } from '../useCollapsedProjects';
import type { SessionGroup as SessionGroupType } from '../view-model/group-sessions';

interface SessionGroupProps {
  group: SessionGroupType;
  renderItem: (item: SessionGroupType['items'][number]) => ReactNode;
}

export function SessionGroup({ group, renderItem }: SessionGroupProps) {
  const { collapsed, toggle } = useCollapsedProjects();
  const isCollapsed = collapsed.has(group.projectId);

  return (
    <div data-testid={`sessions-group-${group.projectId}`}>
      <button
        data-testid={`sessions-group-header-${group.projectId}`}
        type="button"
        onClick={() => toggle(group.projectId)}
        className="sticky top-0 z-[1] flex w-full items-center gap-1 bg-mf-glass px-3 pb-1 pt-[7px] text-left backdrop-blur-[40px] backdrop-saturate-[1.8]"
      >
        <ChevronDownIcon
          className={[
            'size-2.5 flex-shrink-0 text-mf-text-3 transition-transform',
            isCollapsed ? '-rotate-90' : '',
          ].join(' ')}
        />
        <span className="flex-1 truncate text-micro font-bold uppercase tracking-[0.07em] text-mf-text-3">
          {group.projectName}
        </span>
        <span className="text-micro text-mf-text-3">{group.count}</span>
      </button>
      {!isCollapsed && (
        <div data-testid={`sessions-group-items-${group.projectId}`} className="pb-1">
          {group.items.map((item) => renderItem(item))}
        </div>
      )}
    </div>
  );
}
