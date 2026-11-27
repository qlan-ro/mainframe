'use client';

/**
 * One atomic token in a chip field: `/command`, `/skill`, `@file`, `@dir`, a
 * typed `@path` or a `@session`. Rendered by react-lexical's `DirectiveNode`, a
 * non-editable inline decorator, so the caret steps over it in one move and
 * Backspace removes it whole.
 *
 * The shape is the transcript's session chip (`user-directive-renderers.tsx`):
 * the toolbar's outline-badge geometry, 20 px tall, a `muted` fill and a
 * hairline, mono 12 px. So a token reads as the same object before and after
 * it is sent. The colour is the overlay's token colour (`render-highlights`):
 * Blue Ink for commands and paths, the directive hues for skills and sessions.
 * A long path truncates; its full text is the chip's title and accessible name.
 */
import type { DirectiveChipProps } from '@assistant-ui/react-lexical';
import { AtSignIcon, FileIcon, FolderIcon, MessageSquare, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS: Record<string, typeof FileIcon> = {
  command: Wrench,
  skill: Wrench,
  file: FileIcon,
  mention: FileIcon,
  directory: FolderIcon,
  session: MessageSquare,
};

const TINT: Record<string, string> = {
  skill: 'text-mf-directive-skill',
  session: 'text-mf-directive-session',
};

export function ComposerChip({ directiveType, label }: DirectiveChipProps) {
  const Icon = ICONS[directiveType] ?? AtSignIcon;
  return (
    <span
      data-testid={`composer-chip-${directiveType}`}
      data-directive-type={directiveType}
      title={label}
      className={cn(
        'mx-px inline-flex h-5 max-w-[230px] min-w-0 items-center gap-1 rounded-4xl border border-border bg-muted px-1.5 align-[-3px] font-mono text-xs leading-none font-normal select-none',
        TINT[directiveType] ?? 'text-accent-ink',
      )}
    >
      <Icon size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
