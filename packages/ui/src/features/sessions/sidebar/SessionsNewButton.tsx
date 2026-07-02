/**
 * SessionsNewButton — the sidebar "+" entry point.
 *
 * Pill active  → starts the draft in that project directly (native New; the
 *                auto-config hook seeds the draft on activation). Tooltip names it.
 * "All" view   → opens the NewSessionPickerPopover to resolve the project first.
 *
 * Re-"+" retargets the single reused draft (never stacks); the pre-draft selection
 * is remembered so a discard can restore it.
 *
 * The popover branch passes `triggerLabel` to NewSessionPickerPopover instead of
 * wrapping the button in `Hint` itself — `Hint` is a plain function component that
 * doesn't forward arbitrary props/refs, so nesting it directly inside
 * `PopoverTrigger asChild` would swallow the click Radix needs to open the popover
 * (the pill-active branch below wraps `ThreadListPrimitive.New`, a real forwardRef
 * primitive, so that composition is unaffected by the same trap).
 */
import { ThreadListPrimitive, useAssistantRuntime } from '@assistant-ui/react';
import { PlusIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Hint } from '@/components/ui/hint';
import { resetNewThreadDraft } from '../new-thread/reset-new-thread-draft';
import { setDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import { NewSessionPickerPopover } from './NewSessionPickerPopover';

const ICON_BTN =
  'inline-flex size-[22px] items-center justify-center rounded-[6px] text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground';

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
      <Hint label={`New session in ${filterProjectName ?? 'project'}`}>
        <ThreadListPrimitive.New
          asChild
          onClick={() => {
            rememberReturn();
            resetNewThreadDraft(runtime.threads.getState().newThreadId);
          }}
        >
          <button data-testid="sessions-new-button" data-tut="sessions" type="button" className={ICON_BTN}>
            <PlusIcon className="size-[12px]" />
          </button>
        </ThreadListPrimitive.New>
      </Hint>
    );
  }

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
      triggerLabel="New session"
    >
      <button data-testid="sessions-new-button" data-tut="sessions" type="button" className={ICON_BTN}>
        <PlusIcon className="size-[12px]" />
      </button>
    </NewSessionPickerPopover>
  );
}
