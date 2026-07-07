type EnvInput = Record<string, string | undefined>;

const PROCESS_OWNED_KEYS = [
  'DAEMON_PORT',
  'VITE_DAEMON_HTTP_PORT',
  'VITE_DAEMON_WS_PORT',
  'MAINFRAME_DATA_DIR',
] as const;

export function buildDaemonEnv(processEnv: EnvInput, shellEnv: EnvInput): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(shellEnv)) {
    if (value !== undefined) env[key] = value;
  }

  for (const key of PROCESS_OWNED_KEYS) {
    const value = processEnv[key];
    if (value !== undefined) {
      env[key] = value;
    } else {
      delete env[key];
    }
  }

  env.NODE_ENV = 'production';
  return env;
}
