import { useCallback, useState } from 'react';
import { RotateCw } from 'lucide-react';
import type { CliInstallMethod } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { useProviderCliStatus, applyProviderCliStatus, applyProviderCliUpdateStarted } from '@/store/cli-update';
import { checkProviderCliUpdate, updateProviderCli } from '@/lib/api/cli-update';
import { ProviderCliOutput } from './ProviderCliOutput';
import { ProviderCliManualCommand } from './ProviderCliManualCommand';

interface ProviderCliVersionProps {
  port: number;
  adapterId: string;
}

const INSTALL_METHOD_LABEL: Record<CliInstallMethod, string> = {
  homebrew: 'Homebrew',
  npm: 'npm',
  pnpm: 'pnpm',
  bun: 'Bun',
  native: 'native installer',
  unknown: 'unknown install',
};

/**
 * Settings → Providers version/update row (todo #405). Rendered by `ProvidersPane`
 * only when the daemon reports a `ProviderCliStatus` for this adapter — an adapter
 * the daemon doesn't know how to update shows no version section at all.
 *
 * The update itself runs on the daemon host; this component only starts it (POST
 * cli/update) and renders `update.state`/`update.output` as the always-on
 * `provider.cli.updated` subscriber (store/cli-update.ts) replays them.
 */
export function ProviderCliVersion({ port, adapterId }: ProviderCliVersionProps) {
  const status = useProviderCliStatus(adapterId);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  const handleCheck = useCallback(() => {
    setChecking(true);
    setActionError(null);
    checkProviderCliUpdate(adapterId, port)
      .then(applyProviderCliStatus)
      .catch((err: unknown) => console.warn('[settings/ProviderCliVersion] check failed', err))
      .finally(() => setChecking(false));
  }, [adapterId, port]);

  const handleUpdate = useCallback(() => {
    setActionError(null);
    updateProviderCli(adapterId, port)
      .then(applyProviderCliUpdateStarted)
      .catch((err: unknown) => {
        console.warn('[settings/ProviderCliVersion] update failed to start', err);
        setActionError(err instanceof Error ? err.message : 'Could not start the update');
      });
  }, [adapterId, port]);

  if (!status) return null;

  const running = status.update?.state === 'running';
  const succeeded = status.update?.state === 'succeeded';
  const failed = status.update?.state === 'failed';

  return (
    <div
      data-testid={`settings-${adapterId}-cli-version`}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm">
            <span data-testid={`settings-${adapterId}-cli-installed`} className="text-foreground">
              Installed {status.installedVersion ?? '—'}
            </span>
            <span data-testid={`settings-${adapterId}-cli-latest`} className="text-muted-foreground">
              {status.updateAvailable && status.latestVersion
                ? `Latest ${status.latestVersion}`
                : status.latestVersion
                  ? 'Up to date'
                  : 'Latest unknown'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{INSTALL_METHOD_LABEL[status.installMethod]}</span>
          {status.checkFailed && (
            <span className="text-xs text-muted-foreground">Couldn&rsquo;t check for updates</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`settings-${adapterId}-cli-check-button`}
          onClick={handleCheck}
          disabled={checking || running}
        >
          {checking ? (
            <span className="flex items-center gap-1.5">
              <RotateCw className="animate-spin" size={14} />
              Checking…
            </span>
          ) : (
            'Check for updates'
          )}
        </Button>
      </div>

      {status.updateAvailable && status.canUpdate && (
        <Button
          size="sm"
          className="self-start"
          data-testid={`settings-${adapterId}-cli-update-button`}
          onClick={handleUpdate}
          disabled={running}
        >
          {running ? (
            <span className="flex items-center gap-1.5">
              <RotateCw className="animate-spin" size={14} />
              Updating…
            </span>
          ) : (
            `Update to ${status.latestVersion}`
          )}
        </Button>
      )}

      {status.updateAvailable && !status.canUpdate && (
        <ProviderCliManualCommand
          adapterId={adapterId}
          lead="Mainframe can't tell how this CLI was installed. Run this in a terminal:"
          command={status.updateCommand}
        />
      )}

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      {running && status.update && <ProviderCliOutput adapterId={adapterId} output={status.update.output} />}

      {succeeded && status.update && (
        <div data-testid={`settings-${adapterId}-cli-update-result`} className="flex flex-col gap-1">
          <p className="text-xs text-success">Updated to {status.update.versionAfter ?? status.latestVersion}</p>
          <p className="text-xs text-muted-foreground">
            Running sessions keep the previous version until they restart. The model list has been refreshed.
          </p>
          {status.update.output && (
            <button
              type="button"
              onClick={() => setShowOutput((v) => !v)}
              className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {showOutput ? 'Hide output' : 'Show output'}
            </button>
          )}
          {showOutput && <ProviderCliOutput adapterId={adapterId} output={status.update.output} />}
        </div>
      )}

      {failed && status.update && (
        <div data-testid={`settings-${adapterId}-cli-update-result`} className="flex flex-col gap-2">
          <p className="text-xs text-destructive">{status.update.error ?? 'The update failed.'}</p>
          <ProviderCliOutput adapterId={adapterId} output={status.update.output} />
          {status.update.permissionDenied && (
            <ProviderCliManualCommand
              adapterId={adapterId}
              lead="The install looks owned by another user or needs administrator rights. Run this in a terminal instead:"
              command={status.updateCommand}
            />
          )}
        </div>
      )}
    </div>
  );
}
