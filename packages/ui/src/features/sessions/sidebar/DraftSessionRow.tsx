/**
 * DraftSessionRow — the synthetic "New Session" row pinned above the time groups.
 * Purely presentational (state injected by the sidebar wiring): a dashed hollow
 * status dot, the fixed "New Session" title, a hover-revealed ✕ discard that
 * swaps out the `now` label, and a meta line (project chip in All view + ghost).
 */
import type { MouseEvent } from 'react';
import { XIcon } from 'lucide-react';
import { ProjectChip } from '@/components/ui/project-chip';
import { Hint } from '@/components/ui/hint';

interface DraftSessionRowProps {
  projectId: string;
  projectName: string;
  selected: boolean;
  /** True in "All" view (no active project pill) — shows the project chip. */
  showProject: boolean;
  onSelect: () => void;
  onDiscard: () => void;
}

export function DraftSessionRow({
  projectId,
  projectName,
  selected,
  showProject,
  onSelect,
  onDiscard,
}: DraftSessionRowProps) {
  const discard = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDiscard();
  };

  return (
    <button
      type="button"
      data-testid="sessions-draft-row"
      data-active={selected ? 'true' : 'false'}
      onClick={onSelect}
      className="group relative flex w-full items-center gap-[9px] border-l-2 border-l-transparent pb-[9px] pl-2.5 pr-[12px] pt-[8px] text-left transition-colors hover:bg-accent data-[active=true]:border-l-primary data-[active=true]:bg-accent"
    >
      <span
        aria-hidden
        className={`size-[8px] flex-shrink-0 rounded-full border-[1.5px] border-dashed ${selected ? 'border-primary' : 'border-mf-text-3'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex h-[22px] min-w-0 items-center gap-[9px]">
          <span
            data-testid="sessions-draft-row-title"
            className={`flex-1 truncate text-body tracking-normal ${selected ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'}`}
          >
            New Session
          </span>
          <span className="flex-shrink-0 text-micro tabular-nums text-mf-text-3 group-hover:hidden">now</span>
          <Hint label="Discard draft">
            <span
              role="button"
              tabIndex={0}
              data-testid="sessions-draft-row-discard"
              onClick={discard}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') discard(e as unknown as MouseEvent);
              }}
              className="hidden size-5 flex-shrink-0 items-center justify-center rounded-xs text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
            >
              <XIcon className="size-[11px]" />
            </span>
          </Hint>
        </div>
        <div className="mt-[4px] flex min-w-0 items-center gap-[6px] @max-[220px]:hidden">
          {showProject && <ProjectChip projectId={projectId} name={projectName} size={16} />}
          <span className="truncate text-micro text-mf-text-4">draft — clears if you leave without sending</span>
        </div>
      </div>
    </button>
  );
}
