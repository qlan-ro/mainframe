/**
 * CliUnavailable — what the Skills section shows when the daemon found
 * neither the `skills` executable nor its package runner.
 *
 * It names both commands and stops there: no install command to copy, because
 * the daemon — not this window — is the machine that would run it. When that
 * machine is a remote daemon, say which one, or the reader will install the
 * CLI locally and see no change.
 */
import { getActiveDaemon } from '@/lib/daemon/active-daemon';

interface CliUnavailableProps {
  executable: string;
  packageRunner: string;
}

export function CliUnavailable({ executable, packageRunner }: CliUnavailableProps) {
  const daemon = getActiveDaemon();
  const where = daemon.kind === 'remote' ? ` on ${daemon.label}` : '';

  return (
    <div
      data-testid="skills-section-cli-unavailable"
      className="flex flex-col gap-1 rounded-md border-[0.5px] border-border bg-muted/40 px-2 py-1.5"
    >
      <p className="text-body text-foreground">
        Mainframe could not run <span className="font-mono text-label">{executable}</span> or{' '}
        <span className="font-mono text-label">{packageRunner}</span>
        {where}.
      </p>
      <p className="text-label text-muted-foreground">Install the skills CLI to manage skills from here.</p>
    </div>
  );
}
