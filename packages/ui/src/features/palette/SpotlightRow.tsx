import {
  FileIcon,
  MessageSquareIcon,
  BracesIcon,
  FileDiffIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  GitCompareIcon,
  SettingsIcon,
  PanelLeftIcon,
  PanelRightIcon,
  FolderIcon,
  PlayIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { fileIconFor } from '@/lib/editor/file-types';
import type { RowType, SpotlightRow } from './use-spotlight-results';

const ICONS: Record<RowType, ComponentType<{ className?: string }>> = {
  session: MessageSquareIcon,
  file: FileIcon,
  symbol: BracesIcon,
  change: FileDiffIcon,
  command: ChevronRightIcon,
};

/** Per-command glyph, keyed by the stable palette-commands.ts id (06-palette.jsx:69-76). */
const COMMAND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  review: GitCompareIcon,
  settings: SettingsIcon,
  sidebar: PanelLeftIcon,
  inspector: PanelRightIcon,
  files: FolderIcon,
  run: PlayIcon,
};

/** Per-symbol-kind icon tint, keyed by the tag rendered on `@` rows (symbolKindLabel output). */
const SYMBOL_TAG_COLOR: Record<string, string> = {
  fn: 'text-mf-code-fn',
  class: 'text-mf-code-type',
  type: 'text-mf-code-type',
  iface: 'text-mf-code-type',
  const: 'text-mf-code-num',
  var: 'text-mf-code-kw',
  enum: 'text-mf-code-type',
};

function rowIcon(row: SpotlightRow): ComponentType<{ className?: string }> {
  if (row.type === 'command') return COMMAND_ICONS[row.id] ?? ICONS.command;
  if (row.type === 'file') return fileIconFor(row.title);
  return ICONS[row.type];
}

function iconColorClass(row: SpotlightRow, isActive: boolean): string {
  if (isActive) return 'text-primary';
  if (row.type === 'symbol' && row.tag) return SYMBOL_TAG_COLOR[row.tag] ?? 'text-mf-text-3';
  return 'text-mf-text-3';
}

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
  const Icon = rowIcon(row);
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
        <Icon className={`size-[15px] ${iconColorClass(row, isActive)}`} />
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
        <span className="inline-flex size-[16px] shrink-0 items-center justify-center rounded-[4px] bg-mf-chip text-micro font-bold text-mf-text-3">
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
