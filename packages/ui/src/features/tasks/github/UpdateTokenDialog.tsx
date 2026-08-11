/**
 * UpdateTokenDialog — replaces the stored GitHub token without touching the
 * repository link. Reached from the sync pill's menu, and from the import
 * dialog's auth-failure state (which passes `returnTo: 'import'` so a saved
 * token flows straight back into a fresh issue fetch).
 */
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { mfToast } from '@/lib/toast';
import { GitHubTokenField, useSaveGitHubToken } from './GitHubTokenField';
import { useGitHubSyncStore } from './use-github-sync-store';

export function UpdateTokenDialog(): React.ReactElement | null {
  const { dialog, openDialog, closeDialog } = useGitHubSyncStore();
  const { busy, save } = useSaveGitHubToken();

  if (dialog?.kind !== 'token') return null;
  const returnTo = dialog.returnTo;

  const onSave = async (token: string): Promise<void> => {
    if (!(await save(token))) return;
    mfToast.success('GitHub token updated');
    if (returnTo === 'import') openDialog({ kind: 'import' });
    else closeDialog();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <DialogContent data-testid="tasks-github-token-dialog">
        <DialogHeader>
          <DialogTitle>Update GitHub token</DialogTitle>
          <DialogDescription>
            Paste a personal access token that can read and write this repository&apos;s issues. It replaces the token
            stored on this machine.
          </DialogDescription>
        </DialogHeader>
        <GitHubTokenField busy={busy} onSave={(token) => void onSave(token)} testId="tasks-github-token" />
      </DialogContent>
    </Dialog>
  );
}
