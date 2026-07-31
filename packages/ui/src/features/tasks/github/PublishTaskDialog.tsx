/**
 * PublishTaskDialog — confirms creating a GitHub issue from an unpaired task.
 *
 * Shows the exact payload before anything is created, and names the workflow
 * labels that stay behind, so publishing never surprises anyone with what left
 * the board.
 */
import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { mfToast } from '@/lib/toast';
import { useGitHubSyncStore } from './use-github-sync-store';
import { partitionLabels, withheldLabelsSentence } from './workflow-labels';

function PayloadRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function PublishTaskDialog(): React.ReactElement | null {
  const { dialog, link, publish, closeDialog } = useGitHubSyncStore();

  if (dialog?.kind !== 'publish' || link === null) return null;

  const { todo } = dialog;
  const { syncable, withheld } = partitionLabels(todo.labels);
  const withheldSentence = withheldLabelsSentence(withheld);

  const runPublish = async (): Promise<void> => {
    try {
      await publish(todo.id);
      closeDialog();
    } catch (err) {
      mfToast.error('Publish failed', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogContent data-testid="tasks-github-publish-dialog" className="flex max-h-[85vh] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            Publish task #{todo.number} to {link.owner}/{link.repo}?
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <PayloadRow label="Title">
            <p className="text-body text-foreground">{todo.title}</p>
          </PayloadRow>

          {todo.body !== '' && (
            <PayloadRow label="Body">
              <p className="whitespace-pre-wrap text-label leading-relaxed text-foreground">{todo.body}</p>
            </PayloadRow>
          )}

          {syncable.length > 0 && (
            <PayloadRow label="Labels">
              <div data-testid="tasks-github-publish-labels" className="flex flex-wrap gap-1">
                {syncable.map((label) => (
                  <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                    {label}
                  </span>
                ))}
              </div>
            </PayloadRow>
          )}

          {withheldSentence !== '' && <p className="text-caption text-muted-foreground">{withheldSentence}</p>}
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button data-testid="tasks-github-publish-cancel" variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button data-testid="tasks-github-publish-confirm" onClick={() => void runPublish()}>
            Create issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
