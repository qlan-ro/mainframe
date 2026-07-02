/**
 * NewSessionPickerPopover — the anchored "NEW SESSION IN…" project picker shown
 * from the "+" in the "All" view. Prop-driven (counts come from the live thread
 * list via the caller — never a second count source). Picking a project resolves
 * the draft before the chat opens; the chat is still created only on first send.
 *
 * `triggerLabel`, when set, wraps `PopoverTrigger` (a real forwardRef Radix
 * component) in a `Hint` tooltip — NOT the raw `children` — because `Hint` is a
 * plain function component that doesn't forward arbitrary props/refs. Nesting it
 * directly inside `PopoverTrigger asChild` would silently swallow the click/ref
 * Radix needs to open the popover (see the Hint-inside-asChild-trigger trap).
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ProjectChip } from '@/components/ui/project-chip';
import { Hint } from '@/components/ui/hint';

interface NewSessionPickerPopoverProps {
  projects: Project[];
  /** projectId → live session count (from the sidebar's thread list). */
  sessionCounts: Record<string, number>;
  onPick: (projectId: string) => void;
  onAddProject: () => void;
  children: ReactNode;
  /** Optional tooltip label for the trigger (see the file-header note on why this
   * wraps `PopoverTrigger`, not `children`, directly). */
  triggerLabel?: string;
}

function countLabel(count: number): string {
  if (count <= 0) return 'no sessions';
  return `${count} session${count === 1 ? '' : 's'}`;
}

export function NewSessionPickerPopover({
  projects,
  sessionCounts,
  onPick,
  onAddProject,
  children,
  triggerLabel,
}: NewSessionPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const rowClass =
    'flex w-full items-center gap-[8px] rounded-[6px] px-2 py-1.5 text-left text-body transition-colors hover:bg-accent';

  const trigger = <PopoverTrigger asChild>{children}</PopoverTrigger>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {triggerLabel ? <Hint label={triggerLabel}>{trigger}</Hint> : trigger}
      <PopoverContent
        data-testid="sessions-new-picker"
        align="end"
        sideOffset={4}
        className="w-auto min-w-[216px] p-1.5"
      >
        <div className="px-2 py-1 text-micro font-bold uppercase tracking-wide text-muted-foreground">
          New session in…
        </div>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`sessions-new-picker-project-${p.id}`}
            onClick={() => {
              onPick(p.id);
              setOpen(false);
            }}
            className={rowClass}
          >
            <ProjectChip projectId={p.id} name={p.name} size={16} className="min-w-0 flex-1" />
            <span className="flex-shrink-0 text-micro text-mf-text-3">{countLabel(sessionCounts[p.id] ?? 0)}</span>
          </button>
        ))}
        <div className="my-1 h-px bg-border" />
        <button
          type="button"
          data-testid="sessions-new-picker-add-project"
          onClick={() => {
            onAddProject();
            setOpen(false);
          }}
          className={rowClass}
        >
          <FolderPlus className="size-[13px] flex-shrink-0 text-mf-text-3" aria-hidden />
          <span className="text-muted-foreground">Add project…</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
