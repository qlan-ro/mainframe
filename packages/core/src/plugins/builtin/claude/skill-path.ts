import path from 'node:path';
import { homedir } from 'node:os';
import { accessSync, readdirSync, readFileSync } from 'node:fs';

// Claude CLI only accepts slash-command names matching /^[a-zA-Z0-9:_-]+$/
// (processSlashCommand.tsx:307). Mirror that here so any skillName we feed
// into path.join cannot contain "..", "/", or other path-traversal metachars.
// Plugin-qualified names use a single colon, e.g. "work-logger:slack-writer".
const VALID_SKILL_NAME_RE = /^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/;

function isValidSkillName(name: string): boolean {
  return VALID_SKILL_NAME_RE.test(name);
}

/**
 * Like resolveSkillPath but returns null when no SKILL.md is found on disk.
 * Use when you need to distinguish "genuine skill invocation" from "some other
 * slash command that happens to share a name pattern" — the caller only wants
 * to fire skill detection if a real skill file exists.
 */
export function resolveExistingSkillPath(projectPath: string | undefined, skillName: string): string | null {
  if (!isValidSkillName(skillName)) return null;
  // `plugin:skill` qualifies the skill under a specific plugin. Split so we
  // probe the plugin dir by name, not the full qualified string.
  const colonIdx = skillName.indexOf(':');
  const pluginPrefix = colonIdx >= 0 ? skillName.slice(0, colonIdx) : null;
  const leafName = colonIdx >= 0 ? skillName.slice(colonIdx + 1) : skillName;

  const candidates: string[] = [];

  // Plain (unqualified) skills: project → user home → every plugin dir.
  if (!pluginPrefix) {
    if (projectPath) {
      candidates.push(path.join(projectPath, '.claude', 'skills', leafName, 'SKILL.md'));
    }
    candidates.push(path.join(homedir(), '.claude', 'skills', leafName, 'SKILL.md'));

    const pluginsDir = path.join(homedir(), '.claude', 'plugins');
    try {
      for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(pluginsDir, entry.name, 'skills', leafName, 'SKILL.md'));
        }
      }
    } catch {
      /* no plugins dir */
    }
  }

  // Plugin-qualified skills: look up the prefix. Unqualified also falls into
  // the cache walker below so a bare name can still be found there.
  // Cache layout: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
  const cacheDir = path.join(homedir(), '.claude', 'plugins', 'cache');
  try {
    for (const marketplace of readdirSync(cacheDir, { withFileTypes: true })) {
      if (!marketplace.isDirectory()) continue;
      const marketDir = path.join(cacheDir, marketplace.name);
      for (const plugin of readdirSync(marketDir, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue;
        if (pluginPrefix && plugin.name !== pluginPrefix) continue;
        const pluginDir = path.join(marketDir, plugin.name);
        for (const version of readdirSync(pluginDir, { withFileTypes: true })) {
          if (!version.isDirectory()) continue;
          candidates.push(path.join(pluginDir, version.name, 'skills', leafName, 'SKILL.md'));
        }
      }
    }
  } catch {
    /* no cache dir */
  }

  // Also check non-cache plugin dirs for plugin-qualified skills.
  if (pluginPrefix) {
    const pluginsDir = path.join(homedir(), '.claude', 'plugins');
    try {
      for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'cache') continue;
        // Match either exact plugin-name dir or "<plugin>-plugin" convention.
        if (entry.name === pluginPrefix || entry.name === `${pluginPrefix}-plugin`) {
          candidates.push(path.join(pluginsDir, entry.name, 'skills', leafName, 'SKILL.md'));
        }
      }
    } catch {
      /* no plugins dir */
    }
  }

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Read SKILL.md content synchronously, stripping any leading YAML frontmatter
 * so the markdown renderer doesn't emit `<hr>` + `name: …` lines. Returns null
 * if unreadable. Matches what the history path does (history's skillContent
 * comes from the CLI-expanded isMeta body which has no frontmatter). */
export function readSkillContent(skillPath: string): string | null {
  try {
    const raw = readFileSync(skillPath, 'utf8');
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  } catch {
    return null;
  }
}

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

  // Defer to the validating/plugin-aware probe — handles plugin:skill,
  // the marketplace cache layout, and name validation in one place.
  const existing = resolveExistingSkillPath(projectPath, skillName);
  if (existing) {
    cache?.set(skillName, existing);
    return existing;
  }

  // Nothing on disk — fall back to a conventional path so Context can still
  // show the name. Use the leaf for plugin-qualified names to avoid a colon
  // in the directory path (which macOS/Linux allow but looks broken).
  if (!isValidSkillName(skillName)) {
    // Invalid input — return a harmless sentinel that won't resolve anywhere.
    return '';
  }
  const colonIdx = skillName.indexOf(':');
  const leafName = colonIdx >= 0 ? skillName.slice(colonIdx + 1) : skillName;
  const fallback = path.join(homedir(), '.claude', 'skills', leafName, 'SKILL.md');
  cache?.set(skillName, fallback);
  return fallback;
}
