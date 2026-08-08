/**
 * LinkRepoDialog — picks the repository a project's tasks sync with.
 *
 * Only remotes the daemon could resolve to a GitHub `owner/repo` are offered;
 * a free-text repository field is deliberately not a path here. Unlike its
 * sibling dialogs this one does not read `dialog` — the board mounts it only
 * while the link dialog is open, so every open refetches the remotes.
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { listGitHubRemotes, type GitHubRemote } from '@/lib/api/git';
import { CredentialConnect } from '@/features/automations/steps/CredentialConnect';
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { runOrToast } from './run-or-toast';
import { useGitHubSyncStore } from './use-github-sync-store';

const GITHUB_SERVICE = 'github';

function RemoteRow({ remote }: { remote: GitHubRemote }): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
      <RadioGroupItem data-testid={`tasks-github-remote-${remote.name}`} value={remote.name} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{`${remote.owner}/${remote.repo}`}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{remote.name}</span>
    </label>
  );
}

export function LinkRepoDialog(): React.ReactElement {
  const { port, projectId, linkRepo, closeDialog } = useGitHubSyncStore();
  const connectedCredential = useAutomationsStore((s) =>
    s.credentials.includes(GITHUB_SERVICE) ? GITHUB_SERVICE : null,
  );

  const [remotes, setRemotes] = React.useState<GitHubRemote[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (port === null || projectId === null) return;
    let live = true;
    void listGitHubRemotes(port, projectId)
      .then((found) => {
        if (live) setRemotes(found);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(err instanceof Error ? err.message : 'Could not read the project’s git remotes');
      });
    return () => {
      live = false;
    };
  }, [port, projectId]);

  const credentialLabel = connected ?? connectedCredential;
  const remote = remotes.find((candidate) => candidate.name === selected);
  const canConfirm = remote !== undefined && credentialLabel !== null && projectId !== null;

  const confirm = (): Promise<void> =>
    runOrToast('Could not link the repository', async () => {
      if (remote === undefined || credentialLabel === null || projectId === null) return;
      await linkRepo({
        projectId,
        owner: remote.owner,
        repo: remote.repo,
        remoteName: remote.name,
        credentialLabel,
      });
      closeDialog();
    });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent data-testid="tasks-github-link-dialog" className="flex max-h-[85vh] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Link a GitHub repository</DialogTitle>
          <DialogDescription>
            Pick one of this project&apos;s git remotes. Only remotes that resolve to a GitHub owner and repository are
            offered.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {loadError !== null ? (
            <p className="px-2 py-4 text-sm text-destructive">{loadError}</p>
          ) : remotes.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No GitHub remotes in this project&apos;s repository.
            </p>
          ) : (
            <RadioGroup value={selected ?? undefined} onValueChange={setSelected} className="gap-0.5">
              {remotes.map((entry) => (
                <RemoteRow key={entry.name} remote={entry} />
              ))}
            </RadioGroup>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">GitHub credential</span>
            <CredentialConnect
              service={GITHUB_SERVICE}
              testId="tasks-github-credential"
              onChange={(label) => setConnected(label ?? null)}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button data-testid="tasks-github-link-cancel" variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button data-testid="tasks-github-link-confirm" disabled={!canConfirm} onClick={() => void confirm()}>
            Link repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
