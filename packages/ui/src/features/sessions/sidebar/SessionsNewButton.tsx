/**
 * SessionsNewButton — the "New session" full-width row, directly under the
 * Sessions section title (2026-07: was a small "+" header icon; now matches
 * AddProjectRow's full-row treatment for a consistent action-row look).
 *
 * Pill active  → starts the draft in that project directly (native New; the
 *                auto-config hook seeds the draft on activation).
 * "All" view   → opens the NewSessionPickerPopover to resolve the project first.
 *
 * Re-click retargets the single reused draft (never stacks); the pre-draft
 * selection is remembered so a discard can restore it.
 */
import { ThreadListPrimitive, useAssistantRuntime } from '@assistant-ui/react';
import { PlusIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { resetNewThreadDraft } from '../new-thread/reset-new-thread-draft';
import { setDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import { NewSessionPickerPopover } from './NewSessionPickerPopover';
import { useNewSessionPickerTarget } from './use-new-session-picker-target';

const ROW_BTN =
  'flex h-[28px] w-full items-center gap-[8px] rounded-md px-2 text-label font-medium tracking-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

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
  const runtime = useAssistantRuntime();

  /** Snapshot the currently-active session so a discard can return to it. */
  const rememberReturn = () => {
    useDraftReturnTarget.getState().setReturnTarget(runtime.threads.getState().mainThreadId ?? null);
  };

  if (filterProjectId != null) {
    // Pill active — native New; auto-config seeds this project's draft on activation.
    return (
      <ThreadListPrimitive.New
        asChild
        onClick={() => {
          rememberReturn();
          resetNewThreadDraft(runtime.threads.getState().newThreadId);
        }}
      >
        <button data-testid="sessions-new-button" data-tut="sessions" type="button" className={ROW_BTN}>
          <PlusIcon className="size-[13px] flex-shrink-0" />
          <span>New session{filterProjectName != null ? ` in ${filterProjectName}` : ''}</span>
        </button>
      </ThreadListPrimitive.New>
    );
  }

  // Lifted so the global ⌘N hotkey and the zero-session boot fallback can open
  // this SAME anchored popover (see useNewSessionPickerTarget).
  const pickerOpen = useNewSessionPickerTarget((s) => s.open);
  const setPickerOpen = useNewSessionPickerTarget((s) => s.setOpen);

  const pick = (projectId: string) => {
    const nid = runtime.threads.getState().newThreadId;
    if (nid == null) return;
    rememberReturn();
    resetNewThreadDraft(nid);
    setDraftConfig(nid, { projectId, adapterId: 'claude' });
    useNewThreadReady.getState().markReady(nid);
    void runtime.threads.switchToNewThread();
  };

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
