/**
 * GitHubTokenField — a paste-a-PAT input with a save button.
 *
 * The sync feature talks to the real GitHub API, so unlike the Automations
 * placeholder connect (`CredentialConnect`) it must store a token that
 * actually authenticates. The backing store is still the shared automations
 * credential store, under the fixed `github` label the link rows reference.
 */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { mfToast } from '@/lib/toast';
import { useAutomationsStore } from '@/features/automations/data/use-automations-store';

export const GITHUB_CREDENTIAL_LABEL = 'github';

export function useSaveGitHubToken(): { busy: boolean; save: (token: string) => Promise<boolean> } {
  const gateway = useAutomationsStore((s) => s.gateway);
  const addCredential = useAutomationsStore((s) => s.addCredential);
  const [busy, setBusy] = React.useState(false);

  const save = async (token: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      await gateway.putCredential(GITHUB_CREDENTIAL_LABEL, token);
      addCredential(GITHUB_CREDENTIAL_LABEL);
      return true;
    } catch (err) {
      mfToast.error('Could not save the GitHub token', {
        description: err instanceof Error ? err.message : undefined,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, save };
}

export interface GitHubTokenFieldProps {
  busy: boolean;
  onSave: (token: string) => void;
  testId: string;
}

export function GitHubTokenField({ busy, onSave, testId }: GitHubTokenFieldProps): React.ReactElement {
  const [token, setToken] = React.useState('');
  const trimmed = token.trim();
  const canSave = trimmed.length > 0 && !busy;

  const submit = (): void => {
    if (canSave) onSave(trimmed);
  };

  return (
    <div className="flex w-full items-center gap-2">
      <Input
        data-testid={`${testId}-input`}
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="ghp_… or github_pat_…"
        autoComplete="off"
        className="h-8 flex-1 font-mono text-xs"
      />
      <Button data-testid={`${testId}-save`} size="sm" disabled={!canSave} onClick={submit}>
        Save
      </Button>
    </div>
  );
}
