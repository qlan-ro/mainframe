import path from 'node:path';
import { homedir } from 'node:os';
import { accessSync, readdirSync } from 'node:fs';

// Resolve a skill name to its SKILL.md by probing the three locations the
// Claude CLI supports, in priority order: project-local > user > plugin.
// The CLI does not expose a resolved path over stream-json — control_request
// `reload_plugins` returns command names only — so probing is unavoidable.
// Result is cached per session to keep this to one probe per unique skill.
//
// Kept in its own module (no logger dep) so it can be imported from both
// `events.ts` and `history.ts` without creating a module-init cycle that
// would fire `homedir()` during logger bootstrap.
export function resolveSkillPath(
  projectPath: string | undefined,
  skillName: string,
  cache?: Map<string, string>,
): string {
  const cached = cache?.get(skillName);
  if (cached) return cached;

  const candidates: string[] = [];
  if (projectPath) {
    candidates.push(path.join(projectPath, '.claude', 'skills', skillName, 'SKILL.md'));
  }
  candidates.push(path.join(homedir(), '.claude', 'skills', skillName, 'SKILL.md'));

  const pluginsDir = path.join(homedir(), '.claude', 'plugins');
  try {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(pluginsDir, entry.name, 'skills', skillName, 'SKILL.md'));
      }
    }
  } catch {
    /* no plugins dir — expected on fresh installs */
  }

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      cache?.set(skillName, candidate);
      return candidate;
    } catch {
      /* not at this location, try next */
    }
  }

  // Nothing on disk — fall back to the user-home convention so Context shows
  // the name without a broken-looking empty field. ContextFileItem renders a
  // "file not found" state on click, which is honest.
  const fallback = path.join(homedir(), '.claude', 'skills', skillName, 'SKILL.md');
  cache?.set(skillName, fallback);
  return fallback;
}
