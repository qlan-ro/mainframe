'use client';

/**
 * One atomic token in the Lexical composer: `/command`, `/skill`, `@file`,
 * `@agent` or `@session`. Rendered by react-lexical's `DirectiveNode`, a
 * non-editable inline decorator, so the caret steps over it in one move and
 * Backspace removes it whole.
 *
 * The shape is the transcript's session chip (`user-directive-renderers.tsx`),
 * so a token reads as the same object before and after it is sent. Spike only.
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
      className={cn(
        'mx-px inline-flex h-5 max-w-[260px] min-w-0 items-center gap-1 rounded-4xl border border-border bg-muted px-1.5 align-[-3px] font-mono text-xs leading-none select-none',
        TINT[directiveType] ?? 'text-accent-ink',
      )}
    >
      <Icon size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
