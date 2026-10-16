/**
 * Provider CLI version/update status. The daemon pushes the whole status as
 * `provider.cli.updated` on every change; clients replace their copy.
 */

/** How the resolved executable was installed; decides the upgrade command and the latest-version source. */
export type CliInstallMethod = 'homebrew' | 'npm' | 'pnpm' | 'bun' | 'native' | 'unknown';

export type CliUpdateState = 'running' | 'succeeded' | 'failed';

/** The in-flight or most recent in-app update. */
export interface CliUpdateRun {
  state: CliUpdateState;
  /** ANSI-stripped stdout+stderr tail, appended as the command runs. */
  output: string;
  startedAt: number;
  finishedAt?: number;
  /** Why a failed run failed (spawn error, timeout, exit status). */
  error?: string;
  /** The output looked like a permissions failure (root-owned prefix, sudo). */
  permissionDenied: boolean;
  /** The version the CLI reports after a successful run. */
  versionAfter?: string;
}

export interface ProviderCliStatus {
  adapterId: string;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  installMethod: CliInstallMethod;
  executablePath?: string;
  /** The command Update runs, or the one to run by hand when `canUpdate` is false. */
  updateCommand: string;
  canUpdate: boolean;
  /** Epoch ms of the last latest-version check, successful or not. */
  checkedAt?: number;
  /** The last check could not reach the version source (offline, timeout). */
  checkFailed: boolean;
  update?: CliUpdateRun;
}
