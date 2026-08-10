/**
 * One palette result, as a stock CommandItem.
 *
 * cmdk owns selection/keyboard state, so the v1 isActive/rowRef plumbing is
 * gone. The v1 per-symbol-kind code tints are gone too — they were editor
 * syntax colors borrowed for chrome; the resting ink does that job here.
 */
import {
  BracesIcon,
  ChevronRightIcon,
  FileDiffIcon,
  FileIcon,
  GitCompareIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PlayIcon,
  SettingsIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge } from '@/components/ui/badge';
import { CommandItem, CommandShortcut } from '@/components/ui/command';
import { fileIconFor } from '@/lib/editor/file-types';
import type { RowType, SpotlightRow } from '@/features/palette/use-spotlight-results';

const ICONS: Record<RowType, ComponentType<{ className?: string; fill?: string }>> = {
  session: MessageSquareIcon,
  file: FileIcon,
  symbol: BracesIcon,
  change: FileDiffIcon,
  command: ChevronRightIcon,
};

/** Per-command glyph, keyed by the stable palette-commands.ts id. */
const COMMAND_ICONS: Record<string, ComponentType<{ className?: string; fill?: string }>> = {
  review: GitCompareIcon,
  settings: SettingsIcon,
  sidebar: PanelLeftIcon,
  workspace: PlayIcon,
};

/** Command ids whose glyph renders SOLID (design spec: play.fill for the workspace). */
const SOLID_COMMAND_ICONS = new Set(['workspace']);

function rowIcon(row: SpotlightRow): ComponentType<{ className?: string; fill?: string }> {
  if (row.type === 'command') return COMMAND_ICONS[row.id] ?? ICONS.command;
  if (row.type === 'file') return fileIconFor(row.title);
  return ICONS[row.type];
}

function rowIconFill(row: SpotlightRow): string | undefined {
  return row.type === 'command' && SOLID_COMMAND_ICONS.has(row.id) ? 'currentColor' : undefined;
}

export function SpotlightRowView({ row, onSelect }: { row: SpotlightRow; onSelect: (row: SpotlightRow) => void }) {
  const Icon = rowIcon(row);
  const mono = row.type !== 'command';

  return (
    <CommandItem value={row.id} data-testid={row.testid} onSelect={() => onSelect(row)}>
      <Icon className="size-3.5 text-muted-foreground" fill={rowIconFill(row)} />
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className={`truncate ${mono ? 'font-mono' : ''}`}>{row.title}</span>
        {row.sub && <span className="truncate text-xs text-muted-foreground">{row.sub}</span>}
      </span>
      {row.status && (
        <Badge variant="secondary" className="shrink-0 px-1 py-0 font-mono text-xs">
          {row.status}
        </Badge>
      )}
      {row.tag && (
        <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-xs">
          {row.tag}
        </Badge>
      )}
      {row.hint && <CommandShortcut>{row.hint}</CommandShortcut>}
    </CommandItem>
  );
}
