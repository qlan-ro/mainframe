import {
  FileIcon,
  MessageSquareIcon,
  BracesIcon,
  FileDiffIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { RowType, SpotlightRow } from './use-spotlight-results';

const ICONS: Record<RowType, ComponentType<{ className?: string }>> = {
  session: MessageSquareIcon,
  file: FileIcon,
  symbol: BracesIcon,
  change: FileDiffIcon,
  command: ChevronRightIcon,
};

export function SpotlightRowView({
  row,
  isActive,
  rowRef,
  onSelect,
}: {
  row: SpotlightRow;
  isActive: boolean;
  rowRef: (el: HTMLButtonElement | null) => void;
  onSelect: (row: SpotlightRow) => void;
}) {
  const Icon = ICONS[row.type];
  const mono = row.type !== 'command';
  const hasTrailing = Boolean(row.hint || row.tag || row.status);
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? 'true' : 'false'}
      data-testid={row.testid}
      onClick={() => onSelect(row)}
      className={`flex h-[40px] w-full items-center gap-[11px] rounded-[8px] px-[10px] text-left outline-none ${
        isActive ? 'bg-primary/8' : ''
      }`}
    >
      <span className="inline-flex w-5 shrink-0 justify-center">
        <Icon className={`size-[15px] ${isActive ? 'text-primary' : 'text-mf-text-3'}`} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          className={`truncate text-body leading-tight ${mono ? 'font-mono' : ''} ${
            isActive ? 'font-semibold' : 'font-medium'
          } text-foreground`}
        >
          {row.title}
        </span>
        {row.sub && <span className="truncate text-caption leading-tight text-mf-text-3">{row.sub}</span>}
      </span>

      {row.status && (
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-mf-chip text-micro font-bold text-mf-text-3">
          {row.status}
        </span>
      )}
      {row.tag && (
        <span className="shrink-0 rounded-[6px] bg-mf-chip px-[7px] py-[2px] text-micro font-semibold text-mf-text-3">
          {row.tag}
        </span>
      )}
      {row.hint && (
        <span className="inline-flex shrink-0 gap-[3px]">
          {row.hint.split('').map((c, i) => (
            <kbd
              key={`${row.id}-k${i}`}
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] bg-mf-chip px-1 text-micro font-semibold text-mf-text-3"
            >
              {c}
            </kbd>
          ))}
        </span>
      )}
      {isActive && !hasTrailing && <CornerDownLeftIcon className="size-[13px] shrink-0 text-mf-text-3" />}
    </button>
  );
}
