import { homedir } from 'node:os';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;

function expandString(value: string, env: Record<string, string | undefined>): string {
  const expanded = value.replace(VAR_PATTERN, (_match, name: string, defaultValue: string | undefined) => {
    const envValue = env[name];
    if (envValue != null) return envValue;
    if (defaultValue != null) return defaultValue;
    throw new Error(
      `Unresolved variable '${name}' in launch.json. Set it in your environment or provide a default: \${${name}:-<value>}`,
    );
  });

  // Tilde expansion: ~/path or standalone ~
  const home = homedir();
  if (expanded === '~') return home;
  if (expanded.startsWith('~/')) return home + expanded.slice(1);
  return expanded;
}

export function expandVariables(raw: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof raw === 'string') return expandString(raw, env);
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object') return raw;
  if (Array.isArray(raw)) return raw.map((item) => expandVariables(item, env));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = expandVariables(value, env);
  }
  return result;
}
