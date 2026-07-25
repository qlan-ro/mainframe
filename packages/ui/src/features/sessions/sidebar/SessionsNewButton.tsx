/**
 * SessionsNewButton — the "New session" full-width row, directly under the
 * Sessions section title (2026-07: was a small "+" header icon; now matches
 * AddProjectRow's full-row treatment for a consistent action-row look).
 *
 * Pill active  → opens the draft in that project directly.
 * "All" view   → opens the NewSessionPickerPopover to resolve the project first.
 *
 * Both branches run the one `openNewThreadDraft` sequence (spec §2.4): the pill
 * branch used to hand-roll it around `ThreadListPrimitive.New`, and the copy
 * had already drifted — it swallowed a failed initialization instead of
 * surfacing it, so a missing adapter produced a blank draft and no message.
 *
 * Re-click retargets the single reused draft (never stacks); the pre-draft
 * selection is remembered so a discard can restore it.
 */
import { PlusIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { useOpenNewThreadDraft } from '../new-thread/use-open-new-thread-draft';
import { NewSessionPickerPopover } from './NewSessionPickerPopover';
import { useNewSessionPickerTarget } from './use-new-session-picker-target';

// px-[12px] (not px-2/4px): matches SIDEBAR_BASE_INSET_PX, so the wrapping
// SIDEBAR_INDENT_STEP_PX margin in SessionSidebar.tsx lands this row's content
// at the same Level-1 position as SessionGroupHeader's time-group labels.
const ROW_BTN =
  'flex h-[28px] w-full items-center gap-[8px] rounded-md px-[12px] text-label font-medium tracking-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

interface SessionsNewButtonProps {
  filterProjectId: string | null;
  filterProjectName: string | null;
  projects: Project[];
  sessionCounts: Record<string, number>;
  onAddProject: () => void;
}

export function SessionsNewButton({
  filterProjectId,
  filterProjectName,
  projects,
  sessionCounts,
  onAddProject,
}: SessionsNewButtonProps) {
  // Lifted so the global ⌘N hotkey and the zero-session boot fallback can open
  // this SAME anchored popover (see useNewSessionPickerTarget).
  const pickerOpen = useNewSessionPickerTarget((s) => s.open);
  const setPickerOpen = useNewSessionPickerTarget((s) => s.setOpen);
  const openNewThreadDraft = useOpenNewThreadDraft();

  const pick = (projectId: string) => {
    void openNewThreadDraft({ projectId });
  };

  if (filterProjectId != null) {
    return (
      <button
        data-testid="sessions-new-button"
        data-tut="sessions"
        type="button"
        className={ROW_BTN}
        onClick={() => pick(filterProjectId)}
      >
        <PlusIcon className="size-[13px] flex-shrink-0" />
        <span>New session{filterProjectName != null ? ` in ${filterProjectName}` : ''}</span>
      </button>
    );
  }

  return (
    <NewSessionPickerPopover
      projects={projects}
      sessionCounts={sessionCounts}
      onPick={pick}
      onAddProject={onAddProject}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
    >
      <button data-testid="sessions-new-button" data-tut="sessions" type="button" className={ROW_BTN}>
        <PlusIcon className="size-[13px] flex-shrink-0" />
        <span>New session</span>
      </button>
    </NewSessionPickerPopover>
  );
}
