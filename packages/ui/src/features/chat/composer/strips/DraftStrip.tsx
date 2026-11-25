'use client';

/**
 * Before the first message: the project, and next to it the branch and where
 * the session will run (K3, K7). `standalone` is the same row with no card
 * under it, while the project is still unchosen.
 */
import { useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { patchDraftConfig, useDraftConfig } from '@/features/sessions/runtime/draft-config';
import { useSelectDraftProject } from '@/features/sessions/new-thread/use-select-draft-project';
import { WelcomeProjectPicker } from '@/features/sessions/new-thread/WelcomeProjectPicker';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { DraftBranchPicker } from './DraftBranchPicker';
import { TOP_STRIP } from './strip-chrome';

function ProjectShortcut({ open }: { open: () => void }) {
  useShortcutAction('chat.project-picker', open);
  return null;
}

/** With no project there is no branch to pick, so Temporary stands on its own. */
function TemporaryToggle({ localId, on }: { localId: string; on: boolean }) {
  return (
    <button
      type="button"
      data-testid="composer-temporary-toggle"
      aria-pressed={on}
      onClick={() => patchDraftConfig(localId, { temporary: !on })}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-body hover:bg-sidebar-accent focus-visible:focus-line',
        on ? 'bg-chrome-selected text-foreground' : 'text-muted-foreground',
      )}
    >
      <Timer className="size-4" aria-hidden />
      Temporary
    </button>
  );
}

export function DraftStrip({ standalone = false }: { standalone?: boolean }) {
  const threadId = useSideAwareThreadId();
  const draft = useDraftConfig(threadId);
  const selectProject = useSelectDraftProject();
  const focused = useAuiState((s) => s.threads?.mainThreadId === s.threadListItem?.id);
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="composer-draft-strip"
      className={cn(TOP_STRIP, 'gap-1', standalone && 'mx-0 mb-0 rounded-2xl px-2 py-2')}
    >
      {focused && <ProjectShortcut open={() => setOpen(true)} />}
      <WelcomeProjectPicker
        projectId={draft?.projectId}
        onSelect={(id) => void selectProject(id)}
        open={open}
        onOpenChange={setOpen}
        className="h-7 rounded-md px-2 hover:bg-sidebar-accent"
      />
      {threadId != null && draft?.projectId != null && (
        <DraftBranchPicker key={draft.projectId} localId={threadId} projectId={draft.projectId} draft={draft} />
      )}
      {threadId != null && draft?.projectId === null && (
        <TemporaryToggle localId={threadId} on={draft.temporary === true} />
      )}
    </div>
  );
}
