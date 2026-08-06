/**
 * UnlinkRepoConfirm — the "Unlink repo…" confirmation.
 *
 * Mounted only while it is open, so the count it states is always the pair
 * count at the moment the question was asked. The copy carries both facts the
 * spec requires: how many pairs stop syncing, and that nothing is deleted.
 */
import React from 'react';
import { ConfirmDialog } from '@v2/features/shared/ConfirmDialog';
import { runOrToast } from './run-or-toast';
import { useGitHubSyncStore } from './use-github-sync-store';

interface Props {
  onDone: () => void;
}

export function UnlinkRepoConfirm({ onDone }: Props): React.ReactElement | null {
  const { link, pairs, unlinkRepo } = useGitHubSyncStore();
  if (link === null) return null;

  const count = Object.keys(pairs).length;

  return (
    <ConfirmDialog
      open
      testid="tasks-github-unlink-dialog"
      title={`Unlink ${link.owner}/${link.repo}?`}
      body={`${count} ${count === 1 ? 'pair stops' : 'pairs stop'} syncing. Both the tasks and the issues stay exactly as they are — unlinking never deletes anything.`}
      confirmLabel="Unlink"
      destructive
      onCancel={onDone}
      onConfirm={() => {
        onDone();
        void runOrToast('Unlink failed', unlinkRepo);
      }}
    />
  );
}
