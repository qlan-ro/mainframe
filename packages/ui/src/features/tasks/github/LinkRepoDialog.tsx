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
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { runOrToast } from './run-or-toast';
import { GITHUB_CREDENTIAL_LABEL, GitHubTokenField, useSaveGitHubToken } from './GitHubTokenField';
import { useGitHubSyncStore } from './use-github-sync-store';

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
  const gateway = useAutomationsStore((s) => s.gateway);
  const { busy, save } = useSaveGitHubToken();

  const [remotes, setRemotes] = React.useState<GitHubRemote[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [editingToken, setEditingToken] = React.useState(false);

  // The automations store only knows the labels once its surface has loaded,
  // so the connected state is seeded from the daemon, not from that store.
  React.useEffect(() => {
    let live = true;
    void gateway
      .listCredentialLabels()
      .then((labels) => {
        if (live) setConnected(labels.includes(GITHUB_CREDENTIAL_LABEL));
      })
      .catch(() => {
        /* expected — an unreachable daemon reads as "not connected" */
      });
    return () => {
      live = false;
    };
  }, [gateway]);

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

  const remote = remotes.find((candidate) => candidate.name === selected);
  const canConfirm = remote !== undefined && connected && projectId !== null;

  const saveToken = async (token: string): Promise<void> => {
    if (await save(token)) {
      setConnected(true);
      setEditingToken(false);
    }
  };

  const confirm = (): Promise<void> =>
    runOrToast('Could not link the repository', async () => {
      if (remote === undefined || !connected || projectId === null) return;
      await linkRepo({
        projectId,
        owner: remote.owner,
        repo: remote.repo,
        remoteName: remote.name,
        credentialLabel: GITHUB_CREDENTIAL_LABEL,
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

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">GitHub token</span>
              {connected && !editingToken && (
                <span data-testid="tasks-github-credential-connected" className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                  <span className="text-xs text-foreground">connected</span>
                  <Button
                    data-testid="tasks-github-credential-replace"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingToken(true)}
                    className="h-6 px-1.5 text-xs text-muted-foreground"
                  >
                    Replace…
                  </Button>
                </span>
              )}
            </div>
            {(!connected || editingToken) && (
              <GitHubTokenField
                busy={busy}
                onSave={(token) => void saveToken(token)}
                testId="tasks-github-credential"
              />
            )}
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
