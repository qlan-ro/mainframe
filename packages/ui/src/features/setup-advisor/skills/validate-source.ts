/**
 * validate-source — client mirror of the daemon's `skills_cli::validate`
 * (`packages/core-rs/crates/mainframe-server/src/skills_cli/validate.rs`).
 *
 * The daemon stays authoritative; this only saves a round trip and a spawned
 * process for input the daemon would reject anyway. Keep the two in step: a
 * rule relaxed here without relaxing it there just moves the error later.
 */
const ALLOWED_HOSTS = ['github.com', 'www.github.com', 'gitlab.com', 'www.gitlab.com'];

const REJECTED_PREFIXES = ['-', '/', './', '../', '~', 'file:', 'git+file:'];

const SOURCE_ERROR = 'Use an owner/repo shorthand, a github.com or gitlab.com URL, or an SSH remote.';

function isOwnerRepoShorthand(source: string): boolean {
  if (source.includes('://') || source.includes('@')) return false;
  const parts = source.split('/');
  return parts.length >= 2 && parts.every((p) => p.length > 0);
}

function isAllowedHttps(source: string): boolean {
  if (!source.startsWith('https://')) return false;
  const host = source.slice('https://'.length).split('/')[0] ?? '';
  return ALLOWED_HOSTS.includes(host);
}

function isAllowedSsh(source: string): boolean {
  if (!source.startsWith('git@')) return false;
  const rest = source.slice('git@'.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return false;
  const host = rest.slice(0, colon);
  if (!ALLOWED_HOSTS.includes(host)) return false;
  const path = rest.slice(colon + 1).replace(/\.git$/, '');
  const parts = path.split('/');
  return parts.length === 2 && parts.every((p) => p.length > 0);
}

/** The rejection message for `source`, or `null` when the daemon would accept it. */
export function validateSkillsSource(source: string): string | null {
  const trimmed = source.trim();
  if (trimmed.length === 0) return SOURCE_ERROR;
  if (/\s/.test(trimmed)) return SOURCE_ERROR;
  if (REJECTED_PREFIXES.some((p) => trimmed.startsWith(p))) return SOURCE_ERROR;
  if (isOwnerRepoShorthand(trimmed) || isAllowedHttps(trimmed) || isAllowedSsh(trimmed)) return null;
  return SOURCE_ERROR;
}
